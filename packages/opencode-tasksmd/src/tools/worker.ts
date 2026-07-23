import { tool } from "@opencode-ai/plugin"
import { installTaskWorker, uninstallTaskWorker } from "../tasks-scheduler"
import { reconcileTaskSchedulers, spawnWorker } from "../tasks-runtime"
import { readState, writeState } from "../state"

export function createWorkerTools(directory: string, serverUrl?: string) {
  return {
    tasks_start: tool({
      description: "Reconcile board and per-task schedulers, then run any pending work.",
      args: {},
      async execute() {
        await reconcileTaskSchedulers(directory)
        spawnWorker(directory, serverUrl)
        return "Schedulers reconciled."
      },
    }),

    tasks_stop: tool({
      description: "Remove all board and per-task schedulers for this project.",
      args: {},
      async execute() {
        const state = readState(directory)
        for (const slug of Object.keys(state.schedulers)) {
          await uninstallTaskWorker(directory, slug)
        }
        state.schedulers = {}
        writeState(directory, state)
        return "All schedulers removed."
      },
    }),
  }
}
