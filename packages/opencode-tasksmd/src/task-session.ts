import { readState } from "./state"

export function slugForSession(directory: string, sessionID: string): string | undefined {
  if (!sessionID) return undefined

  const state = readState(directory)
  for (const [slug, run] of Object.entries(state.tasks)) {
    if (run.session_id === sessionID) return slug
  }
  return undefined
}

export function latestSessionForTask(directory: string, slug: string): string {
  return readState(directory).tasks[slug]?.session_id ?? ""
}
