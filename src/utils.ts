import { execFileSync } from "node:child_process"

import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
export const bundledSkillsDir = path.join(pluginDir, "skills")
export const bundledWorker = existsSync(path.join(pluginDir, "worker.js"))
  ? path.join(pluginDir, "worker.js")
  : path.join(pluginDir, "worker.ts")

export function opencodePath(): string {
  try {
    const command = process.platform === "win32" ? "where.exe" : "sh"
    const args = process.platform === "win32" ? ["opencode"] : ["-lc", "command -v opencode"]
    return execFileSync(command, args, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]
  } catch {
    return ""
  }
}

export function installWorkerAsset(directory: string): void {
  const targetName = bundledWorker.endsWith(".js") ? "worker.js" : "worker.ts"
  const target = path.join(directory, ".opencode", "tasks", targetName)
  if (path.resolve(target) === path.resolve(bundledWorker)) return
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(bundledWorker, target)
}

export function hasTasksFile(directory: string): boolean {
  return existsSync(path.join(directory, "TASKS.md"))
}
