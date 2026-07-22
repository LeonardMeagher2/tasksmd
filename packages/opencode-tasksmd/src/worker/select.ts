import type { Checklist, ChecklistTask } from "@leonardmeagher2/tasksmd"
import { readState } from "../state"
import { alive } from "./server"
import { log, projectRoot } from "./common"

/**
 * Pick the next root task to run. Active tasks with a dead or missing run
 * record are resumed; a running task is skipped so other work can proceed
 * up to the board's max_active limit.
 */
export function findTask(parsed: Checklist): ChecklistTask | undefined {
  const state = readState(projectRoot)
  const scheduledSlugs = new Set(Object.keys(state.schedulers).filter((s) => s !== ""))
  let activeCount = 0

  for (const task of parsed.roots) {
    if (task.state !== "active") continue
    activeCount++
    if (scheduledSlugs.has(task.slug)) continue
    const runState = state.tasks[task.slug]
    if (!runState) return task
    if (runState.status === "running" && runState.pid && alive(runState.pid)) {
      log(`task=${task.slug} status=running pid=${runState.pid} action=skip`)
      continue
    }
    return task
  }

  const limit = Number(parsed.frontmatter.max_active || 1)
  if (activeCount >= limit) return undefined

  for (const task of parsed.roots) {
    if (task.state === "pending" && !scheduledSlugs.has(task.slug)) return task
  }

  return undefined
}
