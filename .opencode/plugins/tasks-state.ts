import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

function projectId(directory: string): string {
  return createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 16)
}

function userStateRoot(): string {
  if (process.platform === "win32") return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
}

export function taskStateDir(directory: string): string {
  return path.join(userStateRoot(), "opencode-tasks", projectId(directory))
}

export function taskStateFile(directory: string, slug: string): string {
  return path.join(taskStateDir(directory), `${slug}.json`)
}

export function taskLogFile(directory: string): string {
  return path.join(os.tmpdir(), "opencode-tasks", projectId(directory), "worker.log")
}
