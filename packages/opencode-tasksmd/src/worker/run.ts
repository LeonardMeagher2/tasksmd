import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist, replaceTask } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { modelValue, permissionRules, taskPermissions, withDefaultTaskDeny } from "../config"
import { addTaskSession, readState, updateTask } from "../state"
import { latestSessionForTask } from "../task-session"
import { loadTaskConfig } from "../task-config"
import type {
  PermissionRule,
  PluginClient,
  SessionClient,
  SessionResult,
  SessionStatus,
} from "../types"
import { log, resolveProjectRoot, tasksFilePath } from "./common"

export type PromptKind = "fresh" | "resume" | "recurring"

export const LINKED_TASK_BODY_LIMIT = 6000

/** How much of a failure message is kept in the task's run record. */
export const OUTPUT_LIMIT = 2000

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
  if (recurring) return session ? "recurring" : "fresh"
  if (task.state === "active") return session ? "resume" : "fresh"
  if (session) return "recurring"
  return "fresh"
}

/** A `NotFoundError` from the session API means the stored session is gone. */
function sessionMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const details = error as Record<string, unknown>
  const name = typeof details.name === "string" ? details.name.toLowerCase() : ""
  const code = typeof details.code === "string" ? details.code.toLowerCase() : ""
  return name.includes("notfound") || code === "not_found"
}

/** A stored session checked against the runtime, plus the rules it already carries. */
export type ResolvedSession = { id: string; permission: PermissionRule[] }

export const NO_SESSION: ResolvedSession = { id: "", permission: [] }

/**
 * Look up a stored session once per run. An id that no longer resolves is
 * dropped so the run starts fresh instead of resuming a session that is gone.
 */
export async function resolveTaskSession(
  client: SessionClient,
  directory: string,
  sessionID: string,
): Promise<ResolvedSession> {
  if (!sessionID) return NO_SESSION
  const existing = await client.session.get({ path: { id: sessionID }, query: { directory } })
  if (existing.error) {
    if (sessionMissing(existing.error)) return NO_SESSION
    throw new Error(`Failed to load task session: ${JSON.stringify(existing.error)}`)
  }
  const current = existing.data?.permission
  return { id: sessionID, permission: Array.isArray(current) ? (current as PermissionRule[]) : [] }
}

export function sessionStatuses(
  client: PluginClient,
  directory: string,
): Promise<SessionResult<Record<string, SessionStatus>>> {
  return client.session.status({ query: { directory } })
}

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
  client: SessionClient,
  directory: string,
  session: ResolvedSession,
  title: string,
  permission: PermissionRule[],
): Promise<string> {
  if (session.id) {
    const currentRules = new Set(session.permission.map(ruleKey))
    const missing = permission.filter((rule) => !currentRules.has(ruleKey(rule)))
    if (missing.length > 0) {
      const updated = await client.session.update({
        path: { id: session.id },
        query: { directory },
        body: { permission: [...session.permission, ...missing] },
      })
      if (updated?.error) throw new Error(`Failed to apply task permissions: ${JSON.stringify(updated.error)}`)
    }
    return session.id
  }

  const created = await client.session.create({
    query: { directory },
    body: {
      title,
      ...(permission.length > 0 ? { permission } : {}),
    },
  })
  if (created?.error) throw new Error(`Failed to create task session: ${JSON.stringify(created.error)}`)
  return created.data?.id ?? ""
}

export function sessionIsBusy(status: SessionStatus | undefined): boolean {
  return Boolean(status && status.type !== "idle")
}

async function runAttached(
  client: PluginClient,
  directory: string,
  slug: string,
  session: ResolvedSession,
  model: string,
  agent: string,
  prompt: string,
  taskConfig: Record<string, unknown>,
): Promise<{ session: string; skipped: boolean }> {
  const rules = sessionPermissionRules(taskConfig)
  const id = await prepareAttachedSession(client, directory, session, `task:${slug}`, rules)
  if (!id) throw new Error("OpenCode did not return a session ID")

  // Persist session ownership immediately so retries reuse the same session
  // even if status/prompt calls fail afterward.
  addTaskSession(directory, slug, id)

  // Busy-check only applies when reusing an existing session. A newly created
  // session is by definition ours to prompt now, and skipping status avoids
  // creating empty sessions when status lookups transiently fail.
  if (id === session.id) {
    const statuses = await sessionStatuses(client, directory)
    const status = statuses.data?.[id]
    if (status?.type === "retry") throw new Error(`session retry failed: ${status.message}`)
    if (sessionIsBusy(status)) {
      log(directory, `task=${slug} session=${id} status=${status?.type} action=skip`)
      return { session: id, skipped: true }
    }
  }

  // The runtime continues the turn after promptAsync returns.
  const sent = await client.session.promptAsync({
    path: { id },
    query: { directory },
    body: {
      agent: agent || undefined,
      model: modelValue(model),
      parts: [{ type: "text", text: prompt }],
    },
  })
  if (sent.error) throw new Error(JSON.stringify(sent.error))
  return { session: id, skipped: false }
}

export async function runTask(
  directory: string,
  task: ChecklistTask,
  content: string,
  session: string,
  client: PluginClient,
  recurring = false,
): Promise<void> {
  const projectRoot = resolveProjectRoot(directory)
  const knownSession = readState(projectRoot).tasks[task.slug]?.session_id ?? ""
  const resolved = await resolveTaskSession(client, projectRoot, session || knownSession)
  await runResolvedTask(projectRoot, task, content, resolved, client, recurring)
}

async function runResolvedTask(
  projectRoot: string,
  task: ChecklistTask,
  content: string,
  session: ResolvedSession,
  client: PluginClient,
  recurring: boolean,
): Promise<void> {
  const tasksFile = tasksFilePath(projectRoot)
  const kind = promptKind(task, session.id, recurring)

  // Recurring task: reset a completed task to pending and run it again in the same session.
  if (task.state === "done") {
    const updated = replaceTask(content, task.slug, "pending")
    if (updated) {
      writeFileSync(tasksFile, `${updated}\n`)
      const fresh = readFileSync(tasksFile, "utf-8")
      const parsed = parseChecklist(fresh)
      const found = parsed.roots.find((t) => t.slug === task.slug)
      if (found) await runResolvedTask(projectRoot, found, fresh, session, client, true)
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

  let linkedContext = ""
  if (kind === "fresh" && task.link) {
    const linkedPath = path.join(projectRoot, task.link.path)
    linkedContext = linkedTaskContextBlock(task.link.path, readFileSync(linkedPath, "utf-8"))
  }

  const prompt = taskPrompt(task, kind, linkedContext)

  log(projectRoot, `task=${task.slug} kind=${kind} session=${session.id || "new"}`)
  log(projectRoot, `task=${task.slug} action=start mode=attached runtime=plugin`)

  let exitCode = 0
  let sessionId = session.id
  let text = ""
  try {
    const result = await runAttached(client, projectRoot, task.slug, session, model, agent, prompt, taskConfig)
    sessionId = result.session
    if (result.skipped) return
  } catch (error) {
    exitCode = 1
    text = error instanceof Error ? error.message : String(error)
  }

  const status = exitCode === 0 ? "success" : "failed"
  const lastCompleted = status === "success" ? new Date().toISOString() : undefined
  if (sessionId) addTaskSession(projectRoot, task.slug, sessionId)
  updateTask(projectRoot, task.slug, {
    exit_code: exitCode,
    last_completed: lastCompleted,
    output: text.slice(0, OUTPUT_LIMIT),
  })
  log(projectRoot, `task=${task.slug} status=${status} exit_code=${exitCode} session=${sessionId || "none"}`)
}

export async function runTaskBySlug(directory: string, targetSlug: string, client: PluginClient): Promise<void> {
  const projectRoot = resolveProjectRoot(directory)
  const tasksFile = tasksFilePath(projectRoot)
  if (!existsSync(tasksFile)) return

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const task = parsed.roots.find((t) => t.slug === targetSlug)

  if (!task) {
    log(projectRoot, `task=${targetSlug} action=skip reason=not-found`)
    return
  }

  if (task.state === "blocked") {
    log(projectRoot, `task=${targetSlug} action=skip reason=blocked`)
    return
  }

  const session = latestSessionForTask(projectRoot, targetSlug)
  await runTask(projectRoot, task, content, session, client)
}
