import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { tool } from "@opencode-ai/plugin"
import { taskContext } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { parseWorktree } from "../config"
import { readState, updateTask } from "../state"
import { loadTaskConfig } from "../task-config"
import { slugForSession } from "../task-session"
import { resolveProjectRoot } from "../worker/common"
import { linkedTaskContextBlock } from "../worker/run"
import { commitAll, mergeWorktree, removeWorktree } from "../worktree"

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
      description: "Finish your task. Call it with no arguments when the work is done. Pass blocked_reason when you cannot finish, and the task is marked blocked with that reason instead.",
      args: {
        blocked_reason: tool.schema.string().optional().describe("Why the task is blocked. Leave empty when the task is done."),
      },
      async execute(args, ctx) {
        const projectRoot = resolveProjectRoot(directory)
        const slug = slugForSession(directory, ctx.sessionID)
        if (!slug) return "This session is not linked to a task."
        const context = taskContext(projectRoot, slug)
        const reason = args.blocked_reason?.trim() ?? ""
        if (reason) {
          updateTask(projectRoot, slug, { blocked_reason: reason })
          if (!context.markBlocked()) {
            return `Task "${slug}" was not found on the board.`
          }
          return `Task "${slug}" marked blocked: ${reason}`
        }

        // Worktree + auto_merge: commit, merge into the base branch, clean up.
        // Anything that stops the merge keeps the branch and blocks the task so
        // a person can finish it by hand.
        const run = readState(projectRoot).tasks[slug]
        const task = context.current()
        const boardContent = existsSync(context.boardPath) ? readFileSync(context.boardPath, "utf-8") : ""
        const worktreeConfig = task ? parseWorktree(loadTaskConfig(projectRoot, boardContent, task).worktree) : undefined
        if (run?.worktree && run.branch && worktreeConfig?.autoMerge) {
          const info = { path: run.worktree, branch: run.branch, base: run.base ?? "HEAD" }
          commitAll(info, slug)
          const merged = mergeWorktree(projectRoot, info, info.base)
          if (merged !== "merged") {
            const why =
              merged === "wrong-branch"
                ? `auto-merge skipped: the main checkout is no longer on ${info.base}; merge ${run.branch} manually`
                : `auto-merge could not merge ${run.branch} cleanly — merge it manually`
            updateTask(projectRoot, slug, { blocked_reason: why })
            if (!context.markBlocked()) return `Task "${slug}" was not found on the board.`
            return `Task "${slug}" was marked blocked: ${why}`
          }
          removeWorktree(projectRoot, info)
          if (!context.markDone()) return `Task "${slug}" was not found on the board.`
          updateTask(projectRoot, slug, {
            blocked_reason: undefined,
            empty_attempts: undefined,
            worktree: undefined,
            branch: undefined,
            base: undefined,
          })
          return `Task "${slug}" marked done and merged ${run.branch}.`
        }

        if (!context.markDone()) {
          return `Task "${slug}" was not found on the board.`
        }
        updateTask(projectRoot, slug, { blocked_reason: undefined, empty_attempts: undefined })
        return run?.worktree && run.branch
          ? `Task "${slug}" marked done. Changes on branch ${run.branch}.`
          : `Task "${slug}" marked done.`
      },
    }),

    task_info: tool({
      description: "Show the full text of the task assigned to this session. Call this when you need to re-read what you were asked to do.",
      args: {},
      async execute(_args, ctx) {
        const slug = slugForSession(directory, ctx.sessionID)
        if (!slug) return "This session is not linked to a task."
        const context = taskContext(resolveProjectRoot(directory), slug)
        const task = context.current()
        if (!task) return `Task "${slug}" was not found on the board.`
        return taskInfoText(slug, context.boardPath, task)
      },
    }),
  }
}
