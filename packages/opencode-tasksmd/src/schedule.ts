import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { frontmatter } from "@leonardmeagher2/tasksmd"
import type { Checklist } from "@leonardmeagher2/tasksmd"
import { parseEvery } from "./config"

/**
 * Recurring intervals declared on a board, in seconds. The board's own `every`
 * is keyed by the empty string; a root task's `every` comes from its linked
 * file and is keyed by the task slug.
 */
export function boardSchedules(directory: string, parsed: Checklist): Record<string, number> {
  const result: Record<string, number> = {}

  const boardEvery = parseEvery(parsed.frontmatter.every, 0)
  if (boardEvery > 0) result[""] = boardEvery

  for (const task of parsed.roots) {
    if (!task.link) continue
    const linkedFile = path.join(directory, task.link.path)
    if (!existsSync(linkedFile)) continue
    const interval = parseEvery(frontmatter(readFileSync(linkedFile, "utf-8")).every, 0)
    if (interval > 0) result[task.slug] = interval
  }

  return result
}

/** Slugs of root tasks that run on their own schedule. */
export function scheduledTaskSlugs(directory: string, parsed: Checklist): Set<string> {
  return new Set(Object.keys(boardSchedules(directory, parsed)).filter((slug) => slug !== ""))
}
