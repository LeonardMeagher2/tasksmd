import { tool } from "@opencode-ai/plugin"
import {
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
  }
}
