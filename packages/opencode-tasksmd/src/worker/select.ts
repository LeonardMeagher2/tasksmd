import type { Checklist, ChecklistTask } from "@leonardmeagher2/tasksmd"
import { parseMaxActive } from "../config"
import { scheduleDue, taskSchedules, taskWatches } from "../schedule"
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
 * Eligibility, in board order. A task is *due* — it should run when it can —
 * when every trigger it declares is satisfied:
 * - `every`: due when its interval has elapsed (or it has never run);
 * - `watch`: due when a watched path changed since its last dispatch;
 * - both together mean both must hold;
 * - a task with neither is due by board state — active tasks resume, pending start.
 *
 * Position decides order. Recurring and watched tasks sit in the board's order
 * like everything else, so putting them at the top is what makes them run before
 * the work below; being due never lets one jump ahead of a task above it.
 *
 * `max_active` caps how many sessions may be working at once, due tasks
 * included — while every slot is taken, nothing new starts, and `false` or `0`
 * removes the cap. A task left marked active with an idle session, or none at
 * all, holds nothing back: the board marker says a task was started, not that
 * anything is happening.
 */
export async function findTask(directory: string, parsed: Checklist, client: PluginClient): Promise<ChecklistTask | undefined> {
  const projectRoot = resolveProjectRoot(directory)
  let statuses: Record<string, SessionStatus> = {}
  try {
    const response = await sessionStatuses(client, projectRoot)
    statuses = response.data ?? {}
  } catch {
    // If statuses are unavailable, fall back to selecting by board/state only.
  }

  const schedules = taskSchedules(projectRoot, parsed)
  const watches = taskWatches(projectRoot, parsed)
  const tasks = readState(projectRoot).tasks
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

    // `in` and plain indexing reach into Object.prototype — a slug like
    // "constructor" would look configured when it is not. hasOwn stays safe.
    const interval = Object.hasOwn(schedules, task.slug) ? schedules[task.slug] : undefined
    const watched = Object.hasOwn(watches, task.slug)
    if (interval || watched) {
      // Due-ness comes from the task's triggers, not its board marker. Every
      // declared trigger must hold: elapsed for `every`, a change for `watch`.
      const everyDue = !interval || scheduleDue(tasks[task.slug]?.last_run, interval, now)
      const watchDue = !watched || tasks[task.slug]?.triggered === true
      if (everyDue && watchDue) return task
      continue
    }

    if (task.state === "active" || task.state === "pending") return task
  }

  return undefined
}
