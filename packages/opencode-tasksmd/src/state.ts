import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export type TaskRunState = {
  status?: string
  session?: string
  pid?: number
  exit_code?: number
  output?: string
  last_completed?: string
}

export type ProjectState = {
  schedulers: Record<string, number>
  tasks: Record<string, TaskRunState>
}

function projectId(directory: string): string {
  return createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 16)
}

function userStateRoot(): string {
  if (process.platform === "win32") return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
}

export function stateDir(directory: string): string {
  return path.join(userStateRoot(), "opencode-tasksmd", projectId(directory))
}

function stateFile(directory: string): string {
  return path.join(stateDir(directory), "state.json")
}

export function logFile(directory: string): string {
  return path.join(os.tmpdir(), "opencode-tasksmd", projectId(directory), "worker.log")
}

export function readState(directory: string): ProjectState {
  const file = stateFile(directory)
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"))
    return {
      schedulers: data.schedulers ?? {},
      tasks: data.tasks ?? {},
    }
  } catch {
    return { schedulers: {}, tasks: {} }
  }
}

export function writeState(directory: string, state: ProjectState): void {
  const dir = stateDir(directory)
  const file = stateFile(directory)
  const tmp = file + ".tmp"

  mkdirSync(dir, { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(tmp, file)
}

export function updateTask(directory: string, slug: string, update: TaskRunState): void {
  const state = readState(directory)
  state.tasks[slug] = { ...state.tasks[slug], ...update }
  writeState(directory, state)
}
