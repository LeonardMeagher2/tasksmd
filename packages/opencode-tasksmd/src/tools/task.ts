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
      description: "Finish your task. If you include a reason, the task is marked blocked with that reason instead of done.",
      args: {
        reason: tool.schema.string().optional().describe("Why the task is blocked. Leave empty when the task is done."),
      },
      async execute(args, ctx) {
        const slug = slugForSession(directory, ctx.sessionID)
        if (!slug) return "This session is not linked to a task."
        const context = taskContext(directory, slug)
        const reason = args.reason?.trim() ?? ""
        if (reason) {
          if (!context.markBlocked()) {
            return `Task "${slug}" was not found on the board.`
          }
          return `Task "${slug}" marked blocked: ${reason}`
        }
        if (!context.markDone()) {
          return `Task "${slug}" was not found on the board.`
        }
        return `Task "${slug}" marked done.`
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
