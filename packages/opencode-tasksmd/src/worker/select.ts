import type { Checklist, ChecklistTask } from "@leonardmeagher2/tasksmd"
import { parseMaxActive } from "../config"
import { scheduleDue, taskSchedules } from "../schedule"
import { readState } from "../state"
import type { PluginClient, SessionStatus } from "../types"
import { resolveProjectRoot } from "./common"
import { sessionIsBusy, sessionStatuses } from "./run"

/**
 * How long a task holds its slot after being dispatched. The runtime does not
 * report a session as busy the instant it is prompted, and without this a tick
 * landing in that gap would start a second task over the limit.
 */
export const DISPATCH_GRACE_MS = 10_000

/**
 * Pick the next root task to run, walking the board from top to bottom and
 * taking the first one that can run right now. A task whose session is still
 * working is passed over, never waited on.
 *
 * Eligibility, in board order:
 * - a task with its own `every` runs when it is due again, whatever its state;
 * - an active task is resumed;
 * - a pending task starts.
 *
 * Position decides order. Recurring tasks sit in the board's order like
 * everything else, so putting them at the top is what makes them run before the
 * work below; being due never lets one jump ahead of a task above it.
 *
 * `max_active` caps how many sessions may be working at once, recurring tasks
 * included — while every slot is taken, nothing new starts, and `false` or `0`
 * removes the cap. A task left marked active with an idle session, or none at
 * all, holds nothing back: the board marker says a task was started, not that
 * anything is happening.
 */
export async function findTask(directory: string, parsed: Checklist, client: PluginClient): Promise<ChecklistTask | undefined> {
  const projectRoot = resolveProjectRoot(directory)
  const tasks = readState(projectRoot).tasks

  // A worktree session reports status under its own directory. Fetch each
  // distinct one, or a busy worktree task looks idle and gets double-dispatched.
  const dirs = new Set<string>([projectRoot])
  for (const run of Object.values(tasks)) {
    if (run.session_id && run.worktree) dirs.add(run.worktree)
  }
  let statuses: Record<string, SessionStatus> = {}
  for (const dir of dirs) {
    try {
      const response = await sessionStatuses(client, dir)
      statuses = { ...statuses, ...(response.data ?? {}) }
    } catch {
      // If statuses are unavailable, fall back to selecting by board/state only.
    }
  }

  const schedules = taskSchedules(projectRoot, parsed)
  const now = Date.now()

  /** Working, or dispatched too recently for the runtime to say so yet. */
  const occupied = (slug: string) => {
    const run = tasks[slug]
    const sessionID = run?.session_id ?? ""
    if (sessionID && sessionIsBusy(statuses[sessionID])) return true
    const dispatched = run?.last_run ? Date.parse(run.last_run) : Number.NaN
    return !Number.isNaN(dispatched) && now - dispatched < DISPATCH_GRACE_MS
  }

  const limit = parseMaxActive(parsed.frontmatter.max_active)
  if (parsed.roots.filter((task) => occupied(task.slug)).length >= limit) return undefined

  for (const task of parsed.roots) {
    if (task.state === "blocked") continue
    if (occupied(task.slug)) continue

    const interval = schedules[task.slug]
    if (interval) {
      if (scheduleDue(tasks[task.slug]?.last_run, interval, now)) return task
      continue
    }

    if (task.state === "active" || task.state === "pending") return task
  }

  return undefined
}
