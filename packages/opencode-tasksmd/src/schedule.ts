import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseFrontmatter } from "@leonardmeagher2/tasksmd"
import type { Checklist } from "@leonardmeagher2/tasksmd"
import { parseEvery } from "./config"
import type { ProjectState } from "./state"

/** Recurring intervals declared by root tasks, in seconds, keyed by task slug. */
export function taskSchedules(directory: string, parsed: Checklist): Record<string, number> {
  const result: Record<string, number> = {}

  for (const task of parsed.roots) {
    if (!task.link) continue
    const linkedFile = path.join(directory, task.link.path)
    if (!existsSync(linkedFile)) continue
    const interval = parseEvery(parseFrontmatter(readFileSync(linkedFile, "utf-8")).every, 0)
    if (interval > 0) result[task.slug] = interval
  }

  return result
}

/**
 * Recurring intervals declared on a board, in seconds. The board's own `every`
 * is keyed by the empty string; a root task's `every` comes from its linked
 * file and is keyed by the task slug.
 */
export function boardSchedules(directory: string, parsed: Checklist): Record<string, number> {
  const result: Record<string, number> = {}
  const boardEvery = parseEvery(parsed.frontmatter.every, 0)
  if (boardEvery > 0) result[""] = boardEvery
  return { ...result, ...taskSchedules(directory, parsed) }
}

/**
 * Whether a recurring task is due again. Due-ness is measured from the last
 * dispatch recorded in state, not from a timer, so it survives restarts and a
 * missed tick is caught up on the next one.
 */
export function scheduleDue(lastRun: string | undefined, interval: number, now = Date.now()): boolean {
  if (interval <= 0) return false
  if (!lastRun) return true
  const at = Date.parse(lastRun)
  if (Number.isNaN(at)) return true
  return now - at >= interval * 1000
}

/** One line of diagnostics about where a task schedule stands. */
export function scheduleDetail(state: ProjectState, slug: string, interval: number): string {
  if (!slug) return ""
  const lastRun = state.tasks[slug]?.last_run
  const due = scheduleDue(lastRun, interval) ? "yes" : "no"
  return `  last_run: ${lastRun ?? "never"}  due: ${due}`
}
