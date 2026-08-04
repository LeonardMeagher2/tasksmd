import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { logFile } from "../state"

/**
 * Map a directory to the checkout that owns the task board and state. A git
 * worktree (including this plugin's own) shares the main checkout's .git, so
 * the board and state stay anchored there. Cached: this runs on hot paths.
 */
const projectRoots = new Map<string, string>()

export function resolveProjectRoot(directory: string): string {
  const resolved = path.resolve(directory)
  const cached = projectRoots.get(resolved)
  if (cached) return cached

  let root = resolved
  try {
    const marker = path.join(resolved, ".git")
    // A worktree has .git as a file pointing into the main checkout's .git dir.
    if (existsSync(marker) && !statSync(marker).isDirectory()) {
      const result = spawnSync("git", ["-C", resolved, "rev-parse", "--git-common-dir"], { encoding: "utf-8" })
      const common = result.status === 0 ? (result.stdout ?? "").trim() : ""
      if (common) root = path.dirname(path.resolve(resolved, common))
    }
  } catch {
    // Not a worktree or git unavailable — the directory is its own root.
  }

  projectRoots.set(resolved, root)
  return root
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
