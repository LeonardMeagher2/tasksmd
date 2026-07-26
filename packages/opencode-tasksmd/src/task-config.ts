import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { frontmatter, mergeFrontmatter } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"

/** Board frontmatter merged with the linked task file's frontmatter, if any. */
export function loadTaskConfig(
  directory: string,
  boardContent: string,
  task: ChecklistTask,
): Record<string, unknown> {
  const config = frontmatter(boardContent)
  if (!task.link) return config
  const linkedFile = path.join(directory, task.link.path)
  if (!existsSync(linkedFile)) return config
  return mergeFrontmatter(config, frontmatter(readFileSync(linkedFile, "utf-8")))
}
