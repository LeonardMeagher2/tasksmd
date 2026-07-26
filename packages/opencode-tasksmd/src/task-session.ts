import { readState } from "./state"

export function slugForSession(directory: string, sessionID: string): string | undefined {
  const fromEnv = process.env.OPENCODE_TASKS_SLUG
  if (fromEnv) return fromEnv
  if (!sessionID) return undefined

  const state = readState(directory)
  for (const [slug, run] of Object.entries(state.tasks)) {
    if (run.sessions.includes(sessionID)) return slug
  }
  return undefined
}

export function latestSessionForTask(directory: string, slug: string): string {
  const sessions = readState(directory).tasks[slug]?.sessions ?? []
  return sessions[sessions.length - 1] ?? ""
}
