import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist, replaceTask, stripFrontmatter } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { modelValue, parseWorktree, permissionRules, taskPermissions, withDefaultTaskDeny } from "../config"
import { scheduleDue, taskSchedules } from "../schedule"
import { addTaskSession, readState, updateTask } from "../state"
import type { TaskRunState } from "../state"
import { latestSessionForTask } from "../task-session"
import { loadTaskConfig } from "../task-config"
import { ensureWorktree, isGitRepo } from "../worktree"
import type { WorktreeInfo } from "../worktree"
import type {
  AgentRecord,
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

// A linked file's frontmatter is config, already merged into the run via
// `loadTaskConfig` — injecting it into prompts is noise the agent can mistake
// for instructions, so it is stripped here.
export function linkedTaskContextBlock(linkPath: string, body: string, limit = LINKED_TASK_BODY_LIMIT): string {
  const trimmed = stripFrontmatter(body).trim()
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
If stuck, use the task_done tool with blocked_reason.`
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

If you cannot do the task, use the task_done tool with blocked_reason.
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

/** The agent whose permissions a task will inherit. */
export function pickAgent(agents: AgentRecord[], preferred: string): AgentRecord | undefined {
  if (preferred) return agents.find((agent) => agent.name === preferred)
  return agents.find((agent) => agent.name === "build") ?? agents.find((agent) => agent.mode === "primary")
}

/**
 * The ruleset a task session starts from: OpenCode's defaults merged with the
 * agent's own rules and the user's config. Only needed for `auto_approve`; an
 * empty result makes it a no-op rather than a failure.
 */
async function agentRuleset(
  client: PluginClient,
  directory: string,
  preferred: string,
): Promise<PermissionRule[]> {
  const response = await client.app.agents({ query: { directory } })
  if (response.error) throw new Error(JSON.stringify(response.error))
  const agent = pickAgent(response.data ?? [], preferred)
  if (!agent) throw new Error(`agent not found: ${preferred || "(default)"}`)
  return parseRuleset(agent.permission)
}

function ruleKey(rule: PermissionRule): string {
  return `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`
}

/**
 * OpenCode resolves a permission with `findLast`, so the last matching rule
 * wins. Ordering rules least specific first makes a narrow rule beat a broad
 * one regardless of the order they appear in frontmatter — without this,
 * `{ bash: deny, "*": allow }` would silently lose the deny.
 */
function bySpecificity(a: PermissionRule, b: PermissionRule): number {
  const score = (rule: PermissionRule) => (rule.permission === "*" ? 0 : 2) + (rule.pattern === "*" ? 0 : 1)
  return score(a) - score(b)
}

const ACTIONS = new Set(["ask", "allow", "deny"])

/** Read a ruleset off an API response without trusting its shape. */
export function parseRuleset(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const rule = entry as Record<string, unknown>
    if (typeof rule.permission !== "string") return []
    if (typeof rule.pattern !== "string") return []
    if (typeof rule.action !== "string" || !ACTIONS.has(rule.action)) return []
    return [{ permission: rule.permission, pattern: rule.pattern, action: rule.action as PermissionRule["action"] }]
  })
}

/**
 * `auto_approve` turns every question into a yes while leaving refusals alone.
 * OpenCode has already resolved its defaults, the agent and the user's config
 * into one ruleset, so re-issuing that ruleset with `ask` flipped to `allow` is
 * enough — order is preserved, and `deny` rules come back untouched.
 */
export function autoApprovedRules(base: PermissionRule[]): PermissionRule[] {
  return base.map((rule) => (rule.action === "ask" ? { ...rule, action: "allow" as const } : rule))
}

export function sessionPermissionRules(
  taskConfig: Record<string, unknown>,
  baseRuleset: PermissionRule[] = [],
): PermissionRule[] {
  const configured = permissionRules(withDefaultTaskDeny(taskPermissions(taskConfig))) as PermissionRule[]
  const autoApprove = Boolean(taskConfig.auto_approve)
  return [
    // Least specific first: the re-issued base ruleset is the floor, board and
    // task rules refine it, and the plugin's own rules stay last so a board
    // cannot grant a task session control over the scheduler or hide its own
    // status tools.
    ...(autoApprove ? autoApprovedRules(baseRuleset) : []),
    ...[...configured].sort(bySpecificity),
    { permission: "task_done", pattern: "*", action: "allow" },
    { permission: "task_info", pattern: "*", action: "allow" },
    { permission: "tasks_debug", pattern: "*", action: "deny" },
    { permission: "tasks_start", pattern: "*", action: "deny" },
    { permission: "tasks_stop", pattern: "*", action: "deny" },
    { permission: "tasks_run", pattern: "*", action: "deny" },
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
  projectRoot: string,
  sessionDir: string,
  slug: string,
  session: ResolvedSession,
  model: string,
  agent: string,
  prompt: string,
  taskConfig: Record<string, unknown>,
): Promise<{ session: string; skipped: boolean }> {
  let baseRuleset: PermissionRule[] = []
  if (taskConfig.auto_approve) {
    try {
      baseRuleset = await agentRuleset(client, sessionDir, agent)
    } catch (error) {
      // Better to run and let OpenCode ask than to fail the task outright.
      log(projectRoot, `task=${slug} auto_approve=unavailable reason=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const rules = sessionPermissionRules(taskConfig, baseRuleset)
  const id = await prepareAttachedSession(client, sessionDir, session, `task:${slug}`, rules)
  if (!id) throw new Error("OpenCode did not return a session ID")

  // Persist session ownership immediately so retries reuse the same session
  // even if status/prompt calls fail afterward.
  addTaskSession(projectRoot, slug, id)

  // Busy-check only applies when reusing an existing session. A newly created
  // session is by definition ours to prompt now, and skipping status avoids
  // creating empty sessions when status lookups transiently fail.
  if (id === session.id) {
    const statuses = await sessionStatuses(client, sessionDir)
    const status = statuses.data?.[id]
    if (status?.type === "retry") throw new Error(`session retry failed: ${status.message}`)
    if (sessionIsBusy(status)) {
      log(projectRoot, `task=${slug} session=${id} status=${status?.type} action=skip`)
      return { session: id, skipped: true }
    }
  }

  // The runtime continues the turn after promptAsync returns.
  const sent = await client.session.promptAsync({
    path: { id },
    query: { directory: sessionDir },
    body: {
      agent: agent || undefined,
      model: modelValue(model),
      parts: [{ type: "text", text: prompt }],
    },
  })
  if (sent.error) throw new Error(JSON.stringify(sent.error))
  return { session: id, skipped: false }
}

/**
 * Prepare the task's worktree when enabled, recording it in state so selection
 * can find its session directory. Falls back to the project root when the
 * feature is off, the project is not a git repo, or preparation fails.
 */
export function prepareTaskWorktree(
  projectRoot: string,
  slug: string,
  taskConfig: Record<string, unknown>,
  existing: TaskRunState | undefined,
): WorktreeInfo | undefined {
  const config = parseWorktree(taskConfig.worktree)
  if (!config.enabled || !isGitRepo(projectRoot)) {
    if (config.enabled) log(projectRoot, `task=${slug} worktree=disabled reason=not-a-git-repo`)
    if (existing?.worktree) {
      updateTask(projectRoot, slug, { worktree: undefined, branch: undefined, base: undefined, empty_attempts: undefined })
    }
    return undefined
  }

  const info = ensureWorktree(projectRoot, slug)
  if (!info) {
    log(projectRoot, `task=${slug} worktree=unavailable action=run-in-project-root`)
    return undefined
  }

  const base = existing?.worktree === info.path && existing.base ? existing.base : info.base
  updateTask(projectRoot, slug, { worktree: info.path, branch: info.branch, base })
  return { ...info, base }
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
  const existing = readState(projectRoot).tasks[task.slug]
  const taskConfig = loadTaskConfig(projectRoot, content, task)
  const worktree = prepareTaskWorktree(projectRoot, task.slug, taskConfig, existing)
  const sessionDir = worktree?.path ?? projectRoot
  const resolved = await resolveTaskSession(client, sessionDir, session || existing?.session_id || "")
  await runResolvedTask(projectRoot, sessionDir, worktree, task, content, resolved, client, recurring)
}

async function runResolvedTask(
  projectRoot: string,
  sessionDir: string,
  worktree: WorktreeInfo | undefined,
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
      writeFileSync(tasksFile, updated)
      const fresh = readFileSync(tasksFile, "utf-8")
      const parsed = parseChecklist(fresh)
      const found = parsed.roots.find((t) => t.slug === task.slug)
      if (found) await runResolvedTask(projectRoot, sessionDir, worktree, found, fresh, session, client, true)
      return
    }
  }

  if (kind !== "resume") {
    const updated = replaceTask(content, task.slug, "active")
    if (updated) writeFileSync(tasksFile, updated)
  }

  if (task.link && !existsSync(path.join(projectRoot, task.link.path))) {
    const current = readFileSync(tasksFile, "utf-8")
    const marked = replaceTask(current, task.slug, "blocked")
    if (marked) writeFileSync(tasksFile, marked)
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
    const result = await runAttached(client, projectRoot, sessionDir, task.slug, session, model, agent, prompt, taskConfig)
    sessionId = result.session
    if (result.skipped) return
  } catch (error) {
    exitCode = 1
    text = error instanceof Error ? error.message : String(error)
  }

  const status = exitCode === 0 ? "success" : "failed"
  const now = new Date().toISOString()
  const lastCompleted = status === "success" ? now : undefined
  if (sessionId) addTaskSession(projectRoot, task.slug, sessionId)
  // `last_run` records the dispatch, failures included, so a recurring task
  // that keeps failing waits out its interval instead of retrying every tick.
  updateTask(projectRoot, task.slug, {
    exit_code: exitCode,
    last_run: now,
    last_completed: lastCompleted,
    output: text.slice(0, OUTPUT_LIMIT),
  })
  log(projectRoot, `task=${task.slug} status=${status} exit_code=${exitCode} session=${sessionId || "none"}`)
}

export async function runTaskBySlug(directory: string, targetSlug: string, client: PluginClient, force = false): Promise<void> {
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

  // A timer only wakes the task up; state decides whether it is really due, so
  // a run triggered from elsewhere in the meantime is not repeated here. A
  // forced run (tasks_run) skips this check: the user asked for it now.
  const interval = taskSchedules(projectRoot, parsed)[targetSlug]
  if (!force && interval) {
    const lastRun = readState(projectRoot).tasks[targetSlug]?.last_run
    if (!scheduleDue(lastRun, interval)) {
      log(projectRoot, `task=${targetSlug} action=skip reason=not-due last_run=${lastRun}`)
      return
    }
  }

  const session = latestSessionForTask(projectRoot, targetSlug)
  await runTask(projectRoot, task, content, session, client)
}
