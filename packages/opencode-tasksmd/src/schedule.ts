import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseFrontmatter } from "@leonardmeagher2/tasksmd"
import type { Checklist } from "@leonardmeagher2/tasksmd"
import { parseEvery, parseWatch } from "./config"
import type { WatchConfig } from "./config"
import type { ProjectState, TaskRunState } from "./state"

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
 * Watch globs declared by root tasks, keyed by task slug. A task watches the
 * paths and exclusions listed in its linked file's `watch` frontmatter. A slug
 * is present only when at least one watch path is configured.
 */
export function taskWatches(directory: string, parsed: Checklist): Record<string, WatchConfig> {
  const result: Record<string, WatchConfig> = {}

  for (const task of parsed.roots) {
    if (!task.link) continue
    const linkedFile = path.join(directory, task.link.path)
    if (!existsSync(linkedFile)) continue
    const config = parseWatch(parseFrontmatter(readFileSync(linkedFile, "utf-8")).watch)
    if (config.paths.length) result[task.slug] = config
  }

  return result
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

export type TaskReadiness = "ready" | "not-due" | "watch-not-changed"

/** Check the configured `every` and `watch` conditions for one task. */
export function taskReadiness(
  interval: number | undefined,
  hasWatch: boolean,
  state: TaskRunState | undefined,
  now = Date.now(),
): TaskReadiness {
  if (interval && !scheduleDue(state?.last_run, interval, now)) return "not-due"
  if (hasWatch && state?.has_watch_changed !== true) return "watch-not-changed"
  return "ready"
}

/** One line of diagnostics about where a task schedule stands. */
export function scheduleDetail(state: ProjectState, slug: string, interval: number): string {
  if (!slug) return ""
  const lastRun = state.tasks[slug]?.last_run
  const due = scheduleDue(lastRun, interval) ? "yes" : "no"
  return `  last_run: ${lastRun ?? "never"}  due: ${due}`
}

/**
 * Whether any root task is due by trigger right now: a watched path changed
 * and is pending, or a recurring interval has elapsed. Board state alone does
 * not count — this answers "did something happen", not "is there work".
 */
export function anyTriggerDue(directory: string, parsed: Checklist, state: ProjectState, now = Date.now()): boolean {
  const schedules = taskSchedules(directory, parsed)
  const watches = taskWatches(directory, parsed)
  for (const task of parsed.roots) {
    if (task.state === "blocked") continue
    const hasSchedule = Object.hasOwn(schedules, task.slug)
    const hasWatch = Object.hasOwn(watches, task.slug)
    if (!hasSchedule && !hasWatch) continue

    const interval = hasSchedule ? schedules[task.slug] : undefined
    const readiness = taskReadiness(interval, hasWatch, state.tasks[task.slug], now)
    if (readiness === "ready") return true
  }
  return false
}
