import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

import { parseChecklist, replaceTask } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { modelValue, permissionRules, taskPermissions, withDefaultTaskDeny } from "../config"
import { addTaskSession, readState, updateTask } from "../state"
import { latestSessionForTask } from "../task-session"
import { loadTaskConfig } from "../task-config"
import { log, projectRoot, tasksFile } from "./common"
import { findOpencode, findServer, type ServerConnection } from "./server"

export type PromptKind = "fresh" | "resume" | "recurring"

export const LINKED_TASK_BODY_LIMIT = 6000

export function linkedTaskContextBlock(linkPath: string, body: string, limit = LINKED_TASK_BODY_LIMIT): string {
  const trimmed = body.trim()
  if (!trimmed) return `Linked task file: ${linkPath}\n\n(Linked task file is empty)`
  if (trimmed.length <= limit) return `Linked task file: ${linkPath}\n\n${trimmed}`
  return `Linked task file: ${linkPath}\n\n${trimmed.slice(0, limit)}\n\n[Linked task content truncated to ${limit} characters. Read the full linked file before making changes.]`
}

export function taskPrompt(task: ChecklistTask, kind: PromptKind, linkedContext = ""): string {
  if (kind === "resume") {
    return `Task current status: ${task.state}.
Continue the task.
Use the task_info tool to see the task.
When done, use the task_done tool.
If stuck, use the task_blocked tool and say why.`
  }

  const intro = kind === "recurring" ? "This task runs on a schedule. You did it before. Do it again now:" : "Do this task:"
  const linkedSection = kind === "fresh" && linkedContext ? `\n\nLinked task context:\n${linkedContext}` : ""

  return `${intro}

Task current status: ${task.state}.

${task.raw}
${linkedSection}

Steps:
1. Read the task. Read every file it links to.
2. Do the work.
3. Check the work.
4. Use the task_done tool.

If you cannot do the task, use the task_blocked tool and say why.
To see the task again, use the task_info tool.`
}

/**
 * How to prompt this run.
 * - resume: the task is still active — an earlier run was interrupted.
 * - recurring: the task ran before in this session (schedule or manual reset).
 * - fresh: first run.
 */
export function promptKind(task: ChecklistTask, session: string, recurring = false): PromptKind {
  if (!recurring && task.state === "active") return "resume"
  if (recurring || session) return "recurring"
  return "fresh"
}

type PermissionRule = { permission: string; pattern: string; action: "ask" | "allow" | "deny" }

function ruleKey(rule: PermissionRule): string {
  return `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`
}

export function sessionPermissionRules(taskConfig: Record<string, unknown>): PermissionRule[] {
  return [
    ...permissionRules(withDefaultTaskDeny(taskPermissions(taskConfig))) as PermissionRule[],
    { permission: "task_done", pattern: "*", action: "allow" },
    { permission: "task_blocked", pattern: "*", action: "allow" },
    { permission: "task_info", pattern: "*", action: "allow" },
    { permission: "tasks_debug", pattern: "*", action: "deny" },
    { permission: "tasks_start", pattern: "*", action: "deny" },
    { permission: "tasks_stop", pattern: "*", action: "deny" },
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
    const existing = await client.session.get({ sessionID: id, directory })
    if (existing.error) {
      id = ""
    } else if (permission.length > 0) {
      const current = Array.isArray(existing.data?.permission) ? (existing.data.permission as PermissionRule[]) : []
      const currentRules = new Set(current.map(ruleKey))
      const missing = permission.filter((rule) => !currentRules.has(ruleKey(rule)))
      if (missing.length > 0) {
        const updated = await client.session.update({
          sessionID: id,
          directory,
          permission: [...current, ...missing],
        })
        if (updated?.error) throw new Error(`Failed to apply task permissions: ${JSON.stringify(updated.error)}`)
      }
    }
  }

  if (!id) {
    const created = await client.session.create({
      directory,
      title,
      ...(permission.length > 0 ? { permission } : {}),
    })
    if (created?.error) throw new Error(`Failed to create task session: ${JSON.stringify(created.error)}`)
    id = created.data?.id || created.id || ""
  }

  return id
}

function lastSession(sessions: string[]): string {
  return sessions[sessions.length - 1] ?? ""
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

  const statuses = await client.session.status({ directory: projectRoot })
  const status = statuses.data?.[id]
  if (status?.type === "retry") throw new Error(`session retry failed: ${status.message}`)
  if (sessionIsBusy(status)) {
    log(`task=${slug} session=${id} status=${status.type} action=skip`)
    return { session: id, skipped: true }
  }

  // Record the session before prompting so its task tools can resolve the task.
  addTaskSession(projectRoot, slug, id)
  updateTask(projectRoot, slug, { pid: undefined, status: "running" })

  // The server continues the turn after promptAsync returns.
  const sent = await client.session.promptAsync({
    sessionID: id,
    directory: projectRoot,
    agent: agent || undefined,
    model: selectedModel,
    parts: [{ type: "text", text: prompt }],
  })
  if (sent.error) throw new Error(JSON.stringify(sent.error))
  return { session: id, skipped: false }
}

/** First sessionID found in `opencode run --format json` output (one JSON event per line). */
export function extractSessionId(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    try {
      const found = findSessionId(JSON.parse(trimmed), 3)
      if (found) return found
    } catch {
      // Not JSON — skip stderr noise and partial lines.
    }
  }
  return ""
}

function findSessionId(value: unknown, depth: number): string {
  if (depth < 0 || typeof value !== "object" || value === null) return ""
  const record = value as Record<string, unknown>
  if (typeof record.sessionID === "string") return record.sessionID
  for (const child of Object.values(record)) {
    const found = findSessionId(child, depth - 1)
    if (found) return found
  }
  return ""
}

function runStandalone(
  opencode: string,
  args: string[],
  prompt: string,
  slug: string,
  taskPermissionRules: Record<string, unknown>,
): Promise<{ exitCode: number; text: string; pid: number }> {
  return new Promise((resolve) => {
    const output: Buffer[] = []
    const child = spawn(opencode, args, {
      cwd: projectRoot,
      windowsHide: true,
      env: {
        ...process.env,
        BUN_BE_BUN: undefined,
        OPENCODE_TASKS_SLUG: slug,
        ...(Object.keys(taskPermissionRules).length
          ? { OPENCODE_PERMISSION: JSON.stringify(taskPermissionRules) }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    child.stdout.on("data", (data) => output.push(Buffer.from(data)))
    child.stderr.on("data", (data) => output.push(Buffer.from(data)))
    const pid = child.pid ?? process.pid
    updateTask(projectRoot, slug, { pid, status: "running" })
    child.stdin.write(prompt)
    child.stdin.end()
    child.on("error", (error) => {
      output.push(Buffer.from(`failed to start opencode: ${error.message}`))
      resolve({ exitCode: 1, text: Buffer.concat(output).toString("utf-8"), pid })
    })
    child.on("close", (code) =>
      resolve({ exitCode: code ?? 1, text: Buffer.concat(output).toString("utf-8"), pid }),
    )
  })
}

export async function runTask(task: ChecklistTask, content: string, session: string, recurring = false): Promise<void> {
  const kind = promptKind(task, session, recurring)

  // Recurring task: reset a completed task to pending and run it again in the same session.
  if (task.state === "done") {
    const updated = replaceTask(content, task.slug, "pending")
    if (updated) {
      writeFileSync(tasksFile, `${updated}\n`)
      const fresh = readFileSync(tasksFile, "utf-8")
      const parsed = parseChecklist(fresh)
      const found = parsed.roots.find((t) => t.slug === task.slug)
      if (found) await runTask(found, fresh, session, true)
      return
    }
  }

  if (kind !== "resume") {
    const updated = replaceTask(content, task.slug, "active")
    if (updated) writeFileSync(tasksFile, `${updated}\n`)
  }

  if (task.link && !existsSync(path.join(projectRoot, task.link.path))) {
    const current = readFileSync(tasksFile, "utf-8")
    const marked = replaceTask(current, task.slug, "blocked")
    if (marked) writeFileSync(tasksFile, `${marked}\n`)
    throw new Error(`Linked task file not found: ${task.link.path}`)
  }

  const taskConfig = loadTaskConfig(projectRoot, content, task)
  const model = typeof taskConfig.model === "string" ? taskConfig.model : ""
  const agent = typeof taskConfig.agent === "string" ? taskConfig.agent : ""
  const autoApprove = Boolean(taskConfig.auto_approve)
  const taskPermissionRules = withDefaultTaskDeny(taskPermissions(taskConfig))

  let linkedContext = ""
  if (kind === "fresh" && task.link) {
    const linkedPath = path.join(projectRoot, task.link.path)
    linkedContext = linkedTaskContextBlock(task.link.path, readFileSync(linkedPath, "utf-8"))
  }

  const prompt = taskPrompt(task, kind, linkedContext)

  const knownSessions = readState(projectRoot).tasks[task.slug]?.sessions ?? []
  const preferredSession = session || lastSession(knownSessions)

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
  if (autoApprove) args.push("--auto")

  log(`task=${task.slug} kind=${kind} session=${preferredSession || "new"}`)
  log(`task=${task.slug} action=start binary=${opencode}`)

  let exitCode = 0
  let sessionId = preferredSession
  let text = ""
  let workerPid = process.pid
  if (server) {
    try {
      const result = await runAttached(server, task.slug, preferredSession, model, agent, prompt, taskConfig)
      sessionId = result.session
      if (result.skipped) return
    } catch (error) {
      exitCode = 1
      text = error instanceof Error ? error.message : String(error)
    }
  } else {
    let result = await runStandalone(
      opencode,
      preferredSession ? [...args, "--session", preferredSession] : args,
      prompt,
      task.slug,
      taskPermissionRules,
    )
    // The stored session may no longer exist. Try once more in a new session.
    let fellBack = false
    if (result.exitCode !== 0 && preferredSession) {
      log(`task=${task.slug} action=retry reason=session-run-failed session=new`)
      result = await runStandalone(opencode, args, taskPrompt(task, "fresh"), task.slug, taskPermissionRules)
      fellBack = true
    }
    exitCode = result.exitCode
    text = result.text
    workerPid = result.pid
    sessionId = extractSessionId(text) || (fellBack ? "" : preferredSession)
  }

  const status = exitCode === 0 ? "success" : "failed"
  const lastCompleted = status === "success" ? new Date().toISOString() : undefined
  if (sessionId) addTaskSession(projectRoot, task.slug, sessionId)
  updateTask(projectRoot, task.slug, {
    ...(server ? {} : { pid: workerPid }),
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

  const session = latestSessionForTask(projectRoot, targetSlug)
  await runTask(task, content, session)
}
