import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"

import { parseChecklist, replaceTask } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { modelValue, permissionRules, taskPermissions } from "../config"
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

type PermissionRule = Record<string, string>

function ruleKey(rule: PermissionRule): string {
  return `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`
}

export function sessionPermissionRules(taskConfig: Record<string, unknown>): PermissionRule[] {
  return [
    ...permissionRules(taskPermissions(taskConfig)),
    { permission: "tasks_done", pattern: "*", action: "allow" },
    { permission: "tasks_blocked", pattern: "*", action: "allow" },
    { permission: "tasks_debug", pattern: "*", action: "deny" },
  ]
}

export async function prepareAttachedSession(
  client: any,
  directory: string,
  sessionId: string,
  title: string,
  permission: PermissionRule[],
): Promise<string> {
  let id = sessionId

  if (id) {
    const existing = await client.session.get({ path: { id }, query: { directory } })
    if (existing.error) {
      id = ""
    } else if (permission.length > 0) {
      const current = Array.isArray(existing.data?.permission) ? (existing.data.permission as PermissionRule[]) : []
      const currentRules = new Set(current.map(ruleKey))
      const missing = permission.filter((rule) => !currentRules.has(ruleKey(rule)))
      if (missing.length > 0) {
        const updated = await client.session.update({
          path: { id },
          query: { directory },
          body: { permission: missing },
        })
        if (updated?.error) throw new Error(`Failed to apply task permissions: ${JSON.stringify(updated.error)}`)
      }
    }
  }

  if (!id) {
    const created = await client.session.create({
      body: {
        title,
        ...(permission.length > 0 ? { permission } : {}),
      },
      query: { directory },
    })
    if (created?.error) throw new Error(`Failed to create task session: ${JSON.stringify(created.error)}`)
    id = created.data?.id || created.id || ""
  }

  return id
}

export function sessionIsBusy(status: { type?: string } | undefined): boolean {
  return Boolean(status && status.type !== "idle")
}

async function runAttached(
  server: ServerConnection,
  slug: string,
  sessionId: string,
  model: string,
  agent: string,
  prompt: string,
  taskConfig: Record<string, unknown>,
): Promise<{ session: string; skipped: boolean }> {
  const client = createOpencodeClient({
    baseUrl: server.url,
    headers: server.headers,
    directory: projectRoot,
  }) as any
  const selectedModel = modelValue(model)
  const rules = sessionPermissionRules(taskConfig)
  const id = await prepareAttachedSession(client, projectRoot, sessionId, `task:${slug}`, rules)
  if (!id) throw new Error("OpenCode did not return a session ID")

  const statuses = await client.session.status({ query: { directory: projectRoot } })
  const status = statuses.data?.[id]
  if (status?.type === "retry") throw new Error(`session retry failed: ${status.message}`)
  if (sessionIsBusy(status)) {
    log(`task=${slug} session=${id} status=${status.type} action=skip`)
    return { session: id, skipped: true }
  }

  // Record the session before prompting so its task tools can resolve the task.
  updateTask(projectRoot, slug, { pid: undefined, session: id, status: "running" })

  // The server continues the turn after promptAsync returns.
  const sent = await client.session.promptAsync({
    path: { id },
    query: { directory: projectRoot },
    body: {
      agent: agent || undefined,
      model: selectedModel,
      parts: [{ type: "text", text: prompt }],
    },
  })
  if (sent.error) throw new Error(JSON.stringify(sent.error))
  return { session: id, skipped: false }
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
      const result = await runAttached(server, task.slug, session, model, agent, prompt, taskConfig)
      sessionId = result.session
      if (result.skipped) return
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
  updateTask(projectRoot, task.slug, {
    ...(server ? {} : { pid: workerPid }),
    session: sessionId,
    status,
    exit_code: exitCode,
    last_completed: lastCompleted,
    output: text.slice(0, 2000),
  })
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
