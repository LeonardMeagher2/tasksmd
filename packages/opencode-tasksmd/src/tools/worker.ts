import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { tool } from "@opencode-ai/plugin"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import {
  runTaskNow,
  startTaskSchedulers,
  stopTaskSchedulers,
  taskSchedulersEnabled,
} from "../tasks-runtime"

export function createWorkerTools(directory: string) {
  return {
    tasks_start: tool({
      description: "Enable runtime schedulers for this OpenCode session, then run pending work now.",
      args: {},
      async execute() {
        if (taskSchedulersEnabled(directory)) return "Runtime schedulers are already enabled."
        startTaskSchedulers(directory)
        return "Runtime schedulers enabled."
      },
    }),

    tasks_stop: tool({
      description: "Stop runtime schedulers for this OpenCode session.",
      args: {},
      async execute() {
        if (!taskSchedulersEnabled(directory)) return "Runtime schedulers are already stopped."
        stopTaskSchedulers(directory)
        return "Runtime schedulers stopped."
      },
    }),

    tasks_run: tool({
      description: "Run one task now by slug, whether or not schedulers are enabled.",
      args: {
        slug: tool.schema.string().describe("The task's slug, as shown on the board"),
      },
      async execute(args) {
        const boardPath = path.join(directory, "TASKS.md")
        if (!existsSync(boardPath)) return "No TASKS.md in this project."
        const parsed = parseChecklist(readFileSync(boardPath, "utf-8"))
        const task = parsed.roots.find((t) => t.slug === args.slug)
        if (!task) return `No task "${args.slug}" on the board.`
        if (task.state === "blocked") return `Task "${args.slug}" is blocked. Unblock it on the board first.`
        const started = await runTaskNow(directory, args.slug)
        return started
          ? `Task "${args.slug}" dispatched.`
          : "A task run is already in progress. Try again shortly."
      },
    }),
  }
}
