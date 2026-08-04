import { readState } from "./state"
import { resolveProjectRoot } from "./worker/common"

// Session lookups must anchor to the main checkout's state even when the
// calling session runs inside a worktree.
export function slugForSession(directory: string, sessionID: string): string | undefined {
  if (!sessionID) return undefined

  const state = readState(resolveProjectRoot(directory))
  for (const [slug, run] of Object.entries(state.tasks)) {
    if (run.session_id === sessionID) return slug
  }
  return undefined
}

export function latestSessionForTask(directory: string, slug: string): string {
  return readState(resolveProjectRoot(directory)).tasks[slug]?.session_id ?? ""
}
