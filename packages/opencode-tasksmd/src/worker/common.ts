import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

import { logFile } from "../state"

export function resolveProjectRoot(directory: string): string {
  return path.resolve(directory)
}

export function tasksFilePath(directory: string): string {
  return path.join(resolveProjectRoot(directory), "TASKS.md")
}

/**
 * Append to the project's worker log. Runs inside the OpenCode host process, so
 * it must not write to stdout — `tasks_debug` reads the log file instead.
 */
export function log(directory: string, message: string): void {
  const projectRoot = resolveProjectRoot(directory)
  const line = `[tasks ${new Date().toISOString()}] ${message}`
  try {
    const file = logFile(projectRoot)
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, `${line}\n`, "utf-8")
  } catch {
    // Logging must never break a run.
  }
}
