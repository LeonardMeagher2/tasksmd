import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { tool } from "@opencode-ai/plugin"
import { taskContext } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { slugForSession } from "../task-session"
import { linkedTaskContextBlock } from "../worker/run"

export function taskLocation(task: ChecklistTask): string {
  return `Task location: TASKS.md:${task.line + 1}`
}

export function linkedTaskInfo(boardPath: string, task: ChecklistTask): string {
  if (!task.link) return ""
  const linkedPath = path.join(path.dirname(boardPath), task.link.path)
  if (!existsSync(linkedPath)) return `Linked task file: ${task.link.path} (missing)`
  try {
    const content = readFileSync(linkedPath, "utf-8")
    return `Linked task context:\n${linkedTaskContextBlock(task.link.path, content)}`
  } catch {
    return `Linked task file: ${task.link.path} (unreadable)`
  }
}

export function taskInfoText(slug: string, boardPath: string, task: ChecklistTask): string {
  const info = `# Task: ${slug}\nTask current status: ${task.state}\n${taskLocation(task)}\n\n${task.raw}`
  const linked = linkedTaskInfo(boardPath, task)
  return linked ? `${info}\n\n${linked}` : info
}

export function createTaskTools(directory: string) {
  return {
    task_done: tool({
      description: "Mark your task as done on the board. Call this once, after the work is complete and you have verified the result.",
      args: {},
      async execute(_args, ctx) {
        const slug = slugForSession(directory, ctx.sessionID)
        if (!slug) return "This session is not linked to a task."
        return taskContext(directory, slug).markDone()
          ? `Task "${slug}" marked done.`
          : `Task "${slug}" was not found on the board.`
      },
    }),

    task_blocked: tool({
      description: "Mark your task as blocked on the board when you cannot finish it. Give the reason so a person can unblock it.",
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

    task_info: tool({
      description: "Show the full text of the task assigned to this session. Call this when you need to re-read what you were asked to do.",
      args: {},
      async execute(_args, ctx) {
        const slug = slugForSession(directory, ctx.sessionID)
        if (!slug) return "This session is not linked to a task."
        const context = taskContext(directory, slug)
        const task = context.current()
        if (!task) return `Task "${slug}" was not found on the board.`
        return taskInfoText(slug, context.boardPath, task)
      },
    }),
  }
}
