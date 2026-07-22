import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { frontmatter, mergeFrontmatter } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { logFile } from "../state"

export const projectRoot = path.resolve(process.cwd())
export const tasksFile = path.join(projectRoot, "TASKS.md")

export function log(message: string): void {
  const line = `[tasks ${new Date().toISOString()}] ${message}`
  console.log(line)
  try {
    const file = logFile(projectRoot)
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, `${line}\n`, "utf-8")
  } catch {
    // Logging must never break a run.
  }
}

/** Board frontmatter merged with the linked task file's frontmatter, if any. */
export function loadTaskConfig(boardContent: string, task: ChecklistTask): Record<string, unknown> {
  const config = frontmatter(boardContent)
  if (!task.link) return config
  const linkedFile = path.join(projectRoot, task.link.path)
  if (!existsSync(linkedFile)) return config
  return mergeFrontmatter(config, frontmatter(readFileSync(linkedFile, "utf-8")))
}
