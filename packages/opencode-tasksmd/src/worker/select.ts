import type { Checklist, ChecklistTask } from "@leonardmeagher2/tasksmd"
import { scheduledTaskSlugs } from "../schedule"
import { latestSessionForTask } from "../task-session"
import type { PluginClient, SessionStatus } from "../types"
import { resolveProjectRoot } from "./common"
import { sessionIsBusy, sessionStatuses } from "./run"

/**
 * Pick the next root task to run. Active tasks are resumed unless their
 * current session is observably busy in the runtime. Tasks that carry their own
 * schedule are left to their timer.
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

  const scheduledSlugs = scheduledTaskSlugs(projectRoot, parsed)
  let activeCount = 0

  for (const task of parsed.roots) {
    if (task.state !== "active") continue
    activeCount++
    if (scheduledSlugs.has(task.slug)) continue
    const sessionID = latestSessionForTask(projectRoot, task.slug)
    if (sessionID && sessionIsBusy(statuses[sessionID])) continue
    return task
  }

  const limit = Number(parsed.frontmatter.max_active || 1)
  if (activeCount >= limit) return undefined

  for (const task of parsed.roots) {
    if (task.state === "pending" && !scheduledSlugs.has(task.slug)) return task
  }

  return undefined
}
