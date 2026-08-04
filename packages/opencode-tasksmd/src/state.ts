import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export type TaskRunState = {
  session_id?: string
  exit_code?: number
  output?: string
  /** Why the task is blocked, as reported by the task session. */
  blocked_reason?: string
  /** The task's git worktree, when worktrees are enabled. */
  worktree?: string
  branch?: string
  base?: string
  /** Consecutive runs that produced no changes; drives session panic. */
  empty_attempts?: number
  /** When a run was last dispatched, successful or not. Drives recurring schedules. */
  last_run?: string
  last_completed?: string
}

export type ProjectState = {
  tasks: Record<string, TaskRunState>
}

function projectHash(directory: string): string {
  return createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 16)
}

/**
 * A file you can recognise: the project's own directory name. Two projects with
 * the same name share a file, which is the price of a path you can find by eye.
 */
function projectId(directory: string): string {
  const name = path.basename(path.resolve(directory)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return name || "project"
}

function userStateRoot(): string {
  if (process.platform === "win32") return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
}

export function stateFile(directory: string): string {
  return path.join(userStateRoot(), "opencode-tasksmd", `${projectId(directory)}.json`)
}

export function logFile(directory: string): string {
  return path.join(os.tmpdir(), "opencode-tasksmd", `${projectId(directory)}.log`)
}

/** Projects whose state layout this process has already looked at. */
const adopted = new Set<string>()

/**
 * Earlier versions gave each project a folder of its own, first named by hash
 * and then by project. Both held a single `state.json`, so the file is moved up
 * to sit beside its siblings and the empty folder goes. Checked once per
 * project per process — `readState` is on a hot path and there is nothing left
 * to find after the first look.
 */
function adoptLegacyState(directory: string): void {
  const current = stateFile(directory)
  if (adopted.has(current)) return
  adopted.add(current)
  if (existsSync(current)) return

  const root = path.dirname(current)
  for (const folder of [projectHash(directory), projectId(directory)]) {
    const legacy = path.join(root, folder, "state.json")
    if (!existsSync(legacy)) continue
    try {
      renameSync(legacy, current)
      rmSync(path.join(root, folder), { recursive: true, force: true })
    } catch {
      // A project that cannot be moved keeps running; it just starts from empty.
    }
    return
  }
}

export function readState(directory: string): ProjectState {
  adoptLegacyState(directory)
  const file = stateFile(directory)
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"))
    const tasks = Object.fromEntries(
      Object.entries(data.tasks ?? {}).map(([slug, run]) => {
        const record = (run && typeof run === "object") ? (run as Record<string, unknown>) : {}
        const legacySessions = Array.isArray(record.sessions)
          ? record.sessions.filter((session): session is string => typeof session === "string")
          : []
        const session_id = typeof record.session_id === "string"
          ? record.session_id
          : legacySessions[legacySessions.length - 1]
        return [slug, {
          session_id,
          exit_code: typeof record.exit_code === "number" ? record.exit_code : undefined,
          output: typeof record.output === "string" ? record.output : undefined,
          blocked_reason: typeof record.blocked_reason === "string" ? record.blocked_reason : undefined,
          worktree: typeof record.worktree === "string" ? record.worktree : undefined,
          branch: typeof record.branch === "string" ? record.branch : undefined,
          base: typeof record.base === "string" ? record.base : undefined,
          empty_attempts: typeof record.empty_attempts === "number" ? record.empty_attempts : undefined,
          last_run: typeof record.last_run === "string" ? record.last_run : undefined,
          last_completed: typeof record.last_completed === "string" ? record.last_completed : undefined,
        }] satisfies [string, TaskRunState]
      }),
    )
    return { tasks }
  } catch {
    return { tasks: {} }
  }
}

export function writeState(directory: string, state: ProjectState): void {
  const file = stateFile(directory)
  const tmp = file + ".tmp"

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(tmp, file)
}

export function updateTask(directory: string, slug: string, update: Partial<TaskRunState>): void {
  const state = readState(directory)
  const existing = state.tasks[slug] ?? {}
  state.tasks[slug] = { ...existing, ...update }
  writeState(directory, state)
}

export function addTaskSession(directory: string, slug: string, sessionID: string): void {
  if (!sessionID) return
  const state = readState(directory)
  const existing = state.tasks[slug] ?? {}
  state.tasks[slug] = { ...existing, session_id: sessionID }
  writeState(directory, state)
}
