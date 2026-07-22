import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
export const bundledSkillsDir = path.join(pluginDir, "skills")
// dist ships worker.mjs; source mode falls back to worker.ts.
const siblingWorker = ["worker.mjs", "worker.js", "worker.ts"]
  .map((name) => path.join(pluginDir, name))
  .find((candidate) => existsSync(candidate))
export const bundledWorker = siblingWorker

function which(name: string): string {
  try {
    const command = process.platform === "win32" ? "where.exe" : "sh"
    const args = process.platform === "win32" ? [name] : ["-lc", `command -v ${name}`]
    return execFileSync(command, args, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]
  } catch {
    return ""
  }
}

export function opencodePath(): string {
  return which("opencode")
}

export function bunPath(): string {
  return which("bun")
}

/**
 * How to execute the worker script, decided by the plugin host's own runtime:
 * - opencode CLI (bun-compiled): BUN_BE_BUN=1 makes the binary act as bun —
 *   users need no separate bun install.
 * - desktop app (Electron): the same binary doubles as plain Node.js with
 *   ELECTRON_RUN_AS_NODE=1 — no installs needed either.
 */
export type WorkerRuntime = {
  program: string
  /** Arguments before the worker path ("run" for bun, none for node). */
  args: string[]
  env: Record<string, string>
}

export function workerRuntime(): WorkerRuntime {
  if (process.versions.bun) {
    return {
      program: opencodePath() || process.execPath,
      args: ["run"],
      env: { BUN_BE_BUN: "1" },
    }
  }
  return {
    program: process.execPath,
    args: [],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  }
}

/** Path of the installed worker script in a project (prefers the node-compatible .mjs). */
export function workerAsset(directory: string): string {
  const base = path.join(directory, ".opencode", "tasks")
  for (const name of ["worker.mjs", "worker.js", "worker.ts"]) {
    const candidate = path.join(base, name)
    if (existsSync(candidate)) return candidate
  }
  return path.join(base, "worker.mjs")
}

export function installWorkerAsset(directory: string): void {
  // Bundle mode has no sibling worker — the asset is managed externally.
  if (!bundledWorker) return
  const targetName = path.basename(bundledWorker)
  const target = path.join(directory, ".opencode", "tasks", targetName)
  if (path.resolve(target) !== path.resolve(bundledWorker)) {
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(bundledWorker, target)
  }
  // Never leave other variants behind — a stale one would shadow the fresh copy.
  for (const name of ["worker.mjs", "worker.js", "worker.ts"]) {
    if (name !== targetName) rmSync(path.join(directory, ".opencode", "tasks", name), { force: true })
  }
}

export function hasTasksFile(directory: string): boolean {
  return existsSync(path.join(directory, "TASKS.md"))
}
