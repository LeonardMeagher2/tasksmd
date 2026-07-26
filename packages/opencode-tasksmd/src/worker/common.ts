import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

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
