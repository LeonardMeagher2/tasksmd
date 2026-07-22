import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { frontmatter, mergeFrontmatter } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"

export const projectRoot = path.resolve(process.cwd())
export const tasksFile = path.join(projectRoot, "TASKS.md")

export function log(message: string): void {
  console.log(`[tasks ${new Date().toISOString()}] ${message}`)
}

/** Board frontmatter merged with the linked task file's frontmatter, if any. */
export function loadTaskConfig(boardContent: string, task: ChecklistTask): Record<string, unknown> {
  const config = frontmatter(boardContent)
  if (!task.link) return config
  const linkedFile = path.join(projectRoot, task.link.path)
  if (!existsSync(linkedFile)) return config
  return mergeFrontmatter(config, frontmatter(readFileSync(linkedFile, "utf-8")))
}
