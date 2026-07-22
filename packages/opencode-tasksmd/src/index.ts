import { type Plugin } from "@opencode-ai/plugin"

import { createConfigHook } from "./hooks/config"
import { createEventHook } from "./hooks/event"
import { createTaskTools } from "./tools/task"
import { createWorkerTools } from "./tools/worker"
import { installWorkerAsset, hasTasksFile } from "./utils"
import { reconcileTaskSchedulers } from "./tasks-runtime"

export const TasksPlugin: Plugin = async ({ directory, client }) => {
  installWorkerAsset(directory)
  if (hasTasksFile(directory)) await reconcileTaskSchedulers(directory)

  return {
    ...createConfigHook(),
    event: createEventHook(client, directory).event,
    tool: { ...createWorkerTools(directory), ...createTaskTools(directory) },
  }
}

export default TasksPlugin
