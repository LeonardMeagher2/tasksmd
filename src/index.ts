import { type Plugin } from "@opencode-ai/plugin"

import { createConfigHook } from "./hooks/config"
import { createEventHook } from "./hooks/event"
import { createWorkerTools } from "./tools/worker"
import { installWorkerAsset, hasTasksFile } from "./utils"
import { reconcileTaskSchedulers } from "./tasks-runtime"

export const TasksPlugin: Plugin = async ({ directory }) => {
  installWorkerAsset(directory)
  const schedulerEnabled = hasTasksFile(directory)
  if (schedulerEnabled) await reconcileTaskSchedulers(directory)

  return {
    ...createConfigHook(),
    event: createEventHook(directory, schedulerEnabled).event,
    tool: createWorkerTools(directory),
  }
}

export default TasksPlugin
