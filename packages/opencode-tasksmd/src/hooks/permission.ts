import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { readState } from "../state"
import { loadTaskConfig } from "../task-config"

/** Find the task slug whose recorded session matches `sessionID`. */
export function slugForSession(directory: string, sessionID: string): string | undefined {
  if (!sessionID) return undefined
  const state = readState(directory)
  for (const [slug, run] of Object.entries(state.tasks)) {
    if (run.session === sessionID) return slug
  }
  return undefined
}

/** True when the task's merged frontmatter sets `auto_approve` truthy. */
export function taskAutoApprove(directory: string, slug: string): boolean {
  const boardFile = path.join(directory, "TASKS.md")
  if (!existsSync(boardFile)) return false
  const content = readFileSync(boardFile, "utf-8")
  const parsed = parseChecklist(content)
  const task = parsed.roots.find((t) => t.slug === slug)
  if (!task) return false
  const config = loadTaskConfig(directory, content, task)
  return Boolean(config.auto_approve)
}

export function createPermissionHook(directory: string) {
  return {
    "permission.ask": async (
      input: { sessionID: string },
      output: { status: "ask" | "deny" | "allow" },
    ): Promise<void> => {
      if (output.status !== "ask") return
      const slug = slugForSession(directory, input.sessionID)
      if (!slug) return
      if (taskAutoApprove(directory, slug)) output.status = "allow"
    },
  }
}
