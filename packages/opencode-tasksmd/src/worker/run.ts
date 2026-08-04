import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist, replaceTask } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { parseWorktree } from "../config"
import { scheduleDue, taskSchedules } from "../schedule"
import { addTaskSession, readState, updateTask } from "../state"
import type { TaskRunState } from "../state"
import { latestSessionForTask } from "../task-session"
import { loadTaskConfig } from "../task-config"
import { ensureWorktree, isGitRepo } from "../worktree"
import type { WorktreeInfo } from "../worktree"
import type { PluginClient } from "../types"
import { log, resolveProjectRoot, tasksFilePath } from "./common"
import { linkedTaskContextBlock, promptKind, taskPrompt } from "./prompt"
import { resolveTaskSession, runAttached } from "./session"
import type { ResolvedSession } from "./session"

/** How much of a failure message is kept in the task's run record. */
export const OUTPUT_LIMIT = 2000

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
