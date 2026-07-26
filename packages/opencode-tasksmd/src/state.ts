import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export type TaskRunState = {
  status?: string
  sessions: string[]
  pid?: number
  exit_code?: number
  output?: string
  last_completed?: string
}

export type ProjectState = {
  schedulers: Record<string, number>
  tasks: Record<string, TaskRunState>
  /** Last server URL seen by the plugin host — lets scheduled workers attach. */
  server_url?: string
  /** Server password when the host was started with OPENCODE_SERVER_PASSWORD. */
  server_password?: string
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
    const tasks = Object.fromEntries(
      Object.entries(data.tasks ?? {}).map(([slug, run]) => {
        const record = (run && typeof run === "object") ? (run as Record<string, unknown>) : {}
        const sessions = Array.isArray(record.sessions)
          ? record.sessions.filter((session): session is string => typeof session === "string")
          : []
        return [slug, {
          sessions,
          status: typeof record.status === "string" ? record.status : undefined,
          pid: typeof record.pid === "number" ? record.pid : undefined,
          exit_code: typeof record.exit_code === "number" ? record.exit_code : undefined,
          output: typeof record.output === "string" ? record.output : undefined,
          last_completed: typeof record.last_completed === "string" ? record.last_completed : undefined,
        }] satisfies [string, TaskRunState]
      }),
    )
    return {
      schedulers: data.schedulers ?? {},
      tasks,
      server_url: data.server_url,
      server_password: data.server_password,
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

export function updateTask(directory: string, slug: string, update: Partial<TaskRunState>): void {
  const state = readState(directory)
  const existing = state.tasks[slug] ?? { sessions: [] }
  state.tasks[slug] = { ...existing, ...update, sessions: update.sessions ?? existing.sessions }
  writeState(directory, state)
}

export function addTaskSession(directory: string, slug: string, sessionID: string): void {
  if (!sessionID) return
  const state = readState(directory)
  const existing = state.tasks[slug] ?? { sessions: [] }
  const filtered = existing.sessions.filter((current) => current !== sessionID)
  state.tasks[slug] = { ...existing, sessions: [...filtered, sessionID] }
  writeState(directory, state)
}
