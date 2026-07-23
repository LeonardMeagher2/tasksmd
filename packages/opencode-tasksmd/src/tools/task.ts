import { tool } from "@opencode-ai/plugin"
import { taskContext } from "@leonardmeagher2/tasksmd"
import { readState } from "../state"

/**
 * Slug of the task a session belongs to. Standalone worker runs carry the
 * slug in the environment; attached runs are recorded in worker state before
 * the session starts.
 */
function slugForSession(directory: string, sessionID: string): string | undefined {
  const fromEnv = process.env.OPENCODE_TASKS_SLUG
  if (fromEnv) return fromEnv
  const state = readState(directory)
  for (const [slug, run] of Object.entries(state.tasks)) {
    if (run.session === sessionID) return slug
  }
  return undefined
}

export function createTaskTools(directory: string) {
  return {
    tasks_done: tool({
      description: "Mark the task you are currently working on as done. Call only after the work is complete and verified.",
      args: {},
      async execute(_args, ctx) {
        const slug = slugForSession(directory, ctx.sessionID)
        if (!slug) return "This session is not linked to a task."
        return taskContext(directory, slug).markDone()
          ? `Task "${slug}" marked done.`
          : `Task "${slug}" was not found on the board.`
      },
    }),

    tasks_blocked: tool({
      description: "Mark the task you are currently working on as blocked when you cannot proceed. Explain the blocker in your reply.",
      args: {
        reason: tool.schema.string().optional().describe("Why the task is blocked"),
      },
      async execute(args, ctx) {
        const slug = slugForSession(directory, ctx.sessionID)
        if (!slug) return "This session is not linked to a task."
        if (!taskContext(directory, slug).markBlocked()) {
          return `Task "${slug}" was not found on the board.`
        }
        return args.reason
          ? `Task "${slug}" marked blocked: ${args.reason}`
          : `Task "${slug}" marked blocked.`
      },
    }),
  }
}
