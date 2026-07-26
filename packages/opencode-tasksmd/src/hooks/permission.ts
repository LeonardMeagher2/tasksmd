import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { loadTaskConfig } from "../task-config"
import { slugForSession } from "../task-session"

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
