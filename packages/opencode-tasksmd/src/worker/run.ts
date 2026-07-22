import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

import { parseChecklist, replaceTask } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { modelValue, permissionRules, taskPermissions } from "../config"
import { readState, updateTask } from "../state"
import { loadTaskConfig, log, projectRoot, tasksFile } from "./common"
import { findOpencode, findServer, type ServerConnection } from "./server"

const TASK_GUIDANCE = `Work directly on this task in the current project. Inspect relevant files first, then make and verify the requested changes. Resolve routine ambiguity with a sensible minimal result and proceed. If the task links to a file, read it and treat it as the full task. When the work is complete and verified, call the tasks_done tool. When you cannot proceed, call the tasks_blocked tool and state the blocker in your reply. Never edit task markers in TASKS.md yourself.`

async function runAttached(
  server: ServerConnection,
  slug: string,
  sessionId: string,
  model: string,
  agent: string,
  prompt: string,
  permissions: Record<string, unknown>,
): Promise<{ session: string; output: string }> {
  const client = createOpencodeClient({
    baseUrl: server.url,
    headers: server.headers,
    directory: projectRoot,
  }) as any
  const selectedModel = modelValue(model)
  let id = sessionId

  if (!id) {
    const created = await client.session.create({
      title: `task:${slug}`,
      agent: agent || undefined,
      model: selectedModel ? { providerID: selectedModel.providerID, id: selectedModel.modelID } : undefined,
      permission: permissionRules(permissions),
    })
    id = created.data?.id || created.id || ""
  }
  if (!id) throw new Error("OpenCode did not return a session ID")

  updateTask(projectRoot, slug, { pid: process.pid, session: id, status: "running" })
  const result = await client.session.prompt({
    sessionID: id,
    agent: agent || undefined,
    model: selectedModel,
    parts: [{ type: "text", text: prompt }],
  })
  if (result.error) throw new Error(JSON.stringify(result.error))
  return { session: id, output: JSON.stringify(result.data ?? result) }
}

export async function runTask(task: ChecklistTask, content: string, session: string): Promise<void> {
  const isRetry = task.state === "active"

  // Recurring task: reset a completed task to pending and run it again.
  if (task.state === "done") {
    const updated = replaceTask(content, task.slug, "pending")
    if (updated) {
      writeFileSync(tasksFile, `${updated}\n`)
      const fresh = readFileSync(tasksFile, "utf-8")
      const parsed = parseChecklist(fresh)
      const found = parsed.roots.find((t) => t.slug === task.slug)
      if (found) await runTask(found, fresh, "")
      return
    }
  }

  if (!isRetry) {
    const updated = replaceTask(content, task.slug, "active")
    if (updated) writeFileSync(tasksFile, `${updated}\n`)
  }

  if (task.link && !existsSync(path.join(projectRoot, task.link.path))) {
    const current = readFileSync(tasksFile, "utf-8")
    const marked = replaceTask(current, task.slug, "blocked")
    if (marked) writeFileSync(tasksFile, `${marked}\n`)
    throw new Error(`Linked task file not found: ${task.link.path}`)
  }

  const taskConfig = loadTaskConfig(content, task)
  const model = typeof taskConfig.model === "string" ? taskConfig.model : ""
  const agent = typeof taskConfig.agent === "string" ? taskConfig.agent : ""
  const taskPermissionRules = taskPermissions(taskConfig)

  const prompt = isRetry
    ? "Continue the existing task. Check what is already done. If complete, call the tasks_done tool. If blocked, call the tasks_blocked tool and state the blocker. Otherwise finish the remaining work now."
    : `${task.raw}\n\n${TASK_GUIDANCE}`

  const server = await findServer()
  const opencode = findOpencode() || "opencode"
  const args = [
    "run",
    "--format",
    "json",
    "--title",
    `task:${task.slug}`,
  ]
  if (agent) args.push("--agent", agent)
  if (server) {
    args.push("--attach", server.url, "--dir", projectRoot)
    if (server.password) args.push("--password", server.password)
  }
  if (model) args.push("--model", model)
  if (session) args.push("--session", session)

  log(`task=${task.slug} retry=${isRetry} follow_up=${isRetry}`)
  log(`task=${task.slug} action=start binary=${opencode}`)

  let exitCode = 0
  let sessionId = session
  let text = ""
  let workerPid = process.pid
  if (server) {
    try {
      const result = await runAttached(server, task.slug, session, model, agent, prompt, taskPermissionRules)
      sessionId = result.session
      text = result.output
    } catch (error) {
      exitCode = 1
      text = error instanceof Error ? error.message : String(error)
    }
  } else {
    const output: Buffer[] = []
    const child = spawn(opencode, args, {
      cwd: projectRoot,
      windowsHide: true,
      env: {
        ...process.env,
        BUN_BE_BUN: undefined,
        OPENCODE_TASKS_SLUG: task.slug,
        ...(Object.keys(taskPermissionRules).length
          ? { OPENCODE_PERMISSION: JSON.stringify(taskPermissionRules) }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    child.stdout.on("data", (data) => output.push(Buffer.from(data)))
    child.stderr.on("data", (data) => output.push(Buffer.from(data)))
    workerPid = child.pid ?? process.pid
    updateTask(projectRoot, task.slug, { pid: child.pid ?? process.pid, status: "running" })
    child.stdin.write(prompt)
    child.stdin.end()
    exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1))
    })
    text = Buffer.concat(output).toString("utf-8")
    sessionId = text.match(/"sessionID":"([^"]+)"/)?.[1] || session
  }

  const status = exitCode === 0 ? "success" : "failed"
  const lastCompleted = status === "success" ? new Date().toISOString() : undefined
  updateTask(projectRoot, task.slug, { pid: workerPid, session: sessionId, status, exit_code: exitCode, last_completed: lastCompleted, output: text.slice(0, 2000) })
  log(`task=${task.slug} status=${status} exit_code=${exitCode} session=${sessionId || "none"}`)
  process.exitCode = exitCode
}

export async function runTaskBySlug(targetSlug: string): Promise<void> {
  if (!existsSync(tasksFile)) return

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const task = parsed.roots.find((t) => t.slug === targetSlug)

  if (!task) {
    log(`task=${targetSlug} action=skip reason=not-found`)
    return
  }

  if (task.state === "blocked") {
    log(`task=${targetSlug} action=skip reason=blocked`)
    return
  }

  const state = readState(projectRoot)
  const session = task.state === "active" ? state.tasks[targetSlug]?.session || "" : ""
  await runTask(task, content, session)
}
