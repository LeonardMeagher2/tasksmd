import { tool } from "@opencode-ai/plugin"
import { installTaskWorker, uninstallTaskWorker } from "../tasks-scheduler"
import { reconcileTaskSchedulers, spawnWorker } from "../tasks-runtime"
import { readState, writeState } from "../state"

export function createWorkerTools(directory: string) {
  return {
    tasks_start: tool({
      description: "Reconcile board and per-task schedulers, then run any pending work.",
      args: {},
      async execute(_args, ctx) {
        const dir = ctx.directory || directory
        await reconcileTaskSchedulers(dir)
        spawnWorker(dir)
        return "Schedulers reconciled."
      },
    }),

    tasks_remove_schedules: tool({
      description: "Remove all board and per-task schedulers for this project.",
      args: {},
      async execute(_args, ctx) {
        const dir = ctx.directory || directory
        const state = readState(dir)
        for (const slug of Object.keys(state.schedulers)) {
          await uninstallTaskWorker(dir, slug)
        }
        state.schedulers = {}
        writeState(dir, state)
        return "All schedulers removed."
      },
    }),
  }
}
