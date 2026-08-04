import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { tryRunTask } from "../tasks-runtime"
import { readState, updateTask } from "../state"
import { parseWorktree } from "../config"
import { loadTaskConfig } from "../task-config"
import { slugForSession } from "../task-session"
import { log, resolveProjectRoot } from "../worker/common"
import { hasChanges } from "../worktree"
import { showToast } from "./toast"
import type { PluginClient } from "../types"

const DEBOUNCE_MS = 5000
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const blockedCache = new Map<string, Set<string>>()
const toastedRuns = new Set<string>()

function boardPath(directory: string): string {
  return path.join(directory, "TASKS.md")
}

/** True when the changed file is the board or a linked task file. */
function isWorkFile(directory: string, file: string): boolean {
  const resolved = path.resolve(directory, file)
  if (resolved === boardPath(directory)) return true
  if (!file.endsWith(".md")) return false
  try {
    const parsed = parseChecklist(readFileSync(boardPath(directory), "utf-8"))
    return parsed.roots.some((t) => t.link && path.resolve(directory, t.link.path) === resolved)
  } catch {
    return false
  }
}

async function toastNewBlocked(client: PluginClient, directory: string): Promise<void> {
  try {
    const parsed = parseChecklist(readFileSync(boardPath(directory), "utf-8"))
    const blocked = new Set(parsed.roots.filter((t) => t.state === "blocked").map((t) => t.slug))
    const previous = blockedCache.get(directory) ?? new Set<string>()
    const state = readState(directory)
    for (const slug of blocked) {
      if (!previous.has(slug)) {
        const reason = state.tasks[slug]?.blocked_reason
        await showToast(client, reason ? `Task blocked: ${slug} — ${reason}` : `Task blocked: ${slug}`, "warning", "tasksmd")
      }
    }
    blockedCache.set(directory, blocked)
  } catch {
    // Board may be mid-write; the next change retries.
  }
}

async function toastFinishedSession(client: PluginClient, directory: string, sessionID: string): Promise<void> {
  // The worker records its result just as the session goes idle — give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const state = readState(directory)
  for (const [slug, run] of Object.entries(state.tasks)) {
    if (run.session_id !== sessionID) continue
    if (typeof run.exit_code !== "number") continue
    const outcome = run.exit_code === 0 ? "success" : "failed"
    const key = `${slug}:${run.last_completed ?? ""}:${run.exit_code}`
    if (toastedRuns.has(key)) return
    if (toastedRuns.size > 500) toastedRuns.clear()
    toastedRuns.add(key)
    const variant = run.exit_code === 0 ? "success" : "error"
    await showToast(client, `Task ${slug} ${outcome}`, variant, "tasksmd")
    return
  }
}

/**
 * Session panic: when a worktree task's session goes idle without producing
 * any change, count it. At the configured limit, drop the session — the board
 * is untouched, so the next check simply starts the task fresh. Any change
 * resets the count.
 */
export async function checkPanic(client: PluginClient, directory: string, sessionID: string, graceMs = 2000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, graceMs))
  const projectRoot = resolveProjectRoot(directory)
  const slug = slugForSession(projectRoot, sessionID)
  if (!slug) return
  const run = readState(projectRoot).tasks[slug]
  if (!run?.worktree || !run.branch) return

  const board = boardPath(projectRoot)
  if (!existsSync(board)) return
  const content = readFileSync(board, "utf-8")
  const parsed = parseChecklist(content)
  const task = parsed.roots.find((t) => t.slug === slug)
  if (!task || task.state !== "active") return

  const config = parseWorktree(loadTaskConfig(projectRoot, content, task).worktree)
  if (!config.enabled || config.attempts <= 0) return

  const base = run.base ?? "HEAD"
  const info = { path: run.worktree, branch: run.branch, base }
  if (hasChanges(info, base)) {
    if (run.empty_attempts) updateTask(projectRoot, slug, { empty_attempts: undefined })
    return
  }

  const attempts = (run.empty_attempts ?? 0) + 1
  if (attempts < config.attempts) {
    updateTask(projectRoot, slug, { empty_attempts: attempts })
    log(projectRoot, `task=${slug} action=empty-attempt count=${attempts} limit=${config.attempts}`)
    return
  }

  log(projectRoot, `task=${slug} action=panic attempts=${attempts}`)
  try {
    await client.session.delete?.({ path: { id: sessionID }, query: { directory: run.worktree } })
  } catch {
    // A session that cannot be deleted is orphaned; clearing the id still restarts fresh.
  }
  updateTask(projectRoot, slug, { session_id: undefined, empty_attempts: undefined })
}

export function createEventHook(client: PluginClient, directory: string) {
  return {
    event: async ({ event }: { event: { type?: string; properties?: Record<string, unknown> } }) => {
      if (event.type === "session.idle") {
        const sessionID = event.properties?.sessionID
        if (typeof sessionID === "string" && sessionID) {
          await toastFinishedSession(client, directory, sessionID)
          await checkPanic(client, directory, sessionID)
        }
        return
      }

      if (event.type !== "file.edited" && event.type !== "file.watcher.updated") return
      if (!existsSync(boardPath(directory))) return
      const file = event.properties?.file
      if (typeof file !== "string" || !isWorkFile(directory, file)) return

      await toastNewBlocked(client, directory)

      const existing = debounceTimers.get(directory)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        debounceTimers.delete(directory)
        tryRunTask(directory)
      }, DEBOUNCE_MS)
      timer.unref?.()
      debounceTimers.set(directory, timer)
    },
  }
}
