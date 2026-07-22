import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"

import { parseChecklist, replaceTask } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { modelValue, taskPermissions, taskTools } from "../config"
import { readState, updateTask } from "../state"
import { loadTaskConfig, log, projectRoot, tasksFile } from "./common"
import { findOpencode, findServer, type ServerConnection } from "./server"

function taskPrompt(task: ChecklistTask, isRetry: boolean): string {
  return `# Task

${task.raw}

# Rules
${isRetry ? "- In progress already — check what is done, then finish it.\n" : ""}- Read any linked file in full.
- Verify your work before finishing.
- Call tasks_done when complete, or tasks_blocked with the reason you are stuck.`
}

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

  // A stored session may have been deleted from the server — start fresh then.
  if (id) {
    const existing = await client.session.get({ path: { id }, query: { directory: projectRoot } })
    if (existing.error) {
      log(`task=${slug} session=${id} action=discard reason=session-gone`)
      id = ""
    }
  }

  // Note: the v1 session API has no per-session permission ruleset — task
  // `permission` frontmatter only takes effect in standalone (CLI) mode.
  if (!id) {
    const created = await client.session.create({
      body: { title: `task:${slug}` },
      query: { directory: projectRoot },
    })
    id = created.data?.id || created.id || ""
  }
  if (!id) throw new Error("OpenCode did not return a session ID")

  updateTask(projectRoot, slug, { pid: process.pid, session: id, status: "running" })

  // Fire-and-poll: the synchronous message endpoint can hold the request open
  // past completion on some servers. promptAsync returns immediately; we poll
  // session status until the turn is done.
  const sent = await client.session.promptAsync({
    path: { id },
    query: { directory: projectRoot },
    body: {
      agent: agent || undefined,
      model: selectedModel,
      tools: { ...taskTools(taskConfig), tasks_done: true, tasks_blocked: true, tasks_debug: false },
      parts: [{ type: "text", text: prompt }],
    },
  })
  if (sent.error) throw new Error(JSON.stringify(sent.error))

  const deadline = Date.now() + 30 * 60 * 1000
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const statuses = await client.session.status({ query: { directory: projectRoot } })
    const status = statuses.data?.[id]
    if (!status || status.type === "idle") break
    if (status.type === "retry") throw new Error(`session retry failed: ${status.message}`)
    if (Date.now() > deadline) throw new Error("session timed out after 30 minutes")
  }

  let output = ""
  try {
    const messages = await client.session.messages({ path: { id }, query: { directory: projectRoot, limit: 1 } })
    output = JSON.stringify(messages.data ?? messages)
  } catch {
    output = "{}"
  }
  return { session: id, output }
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

  const prompt = taskPrompt(task, isRetry)

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
      child.on("error", (error) => {
        output.push(Buffer.from(`failed to start opencode: ${error.message}`))
        resolve(1)
      })
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
