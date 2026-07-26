import { type Plugin } from "@opencode-ai/plugin"

import { createEventHook } from "./hooks/event"
import { createPermissionHook } from "./hooks/permission"
import { createDebugTool } from "./tools/debug"
import { createTaskTools } from "./tools/task"
import { createWorkerTools } from "./tools/worker"
import { registerTaskRuntimeClient } from "./tasks-runtime"
import type { PluginClient } from "./types"
import { installBundledSkill } from "./utils"

export const TasksPlugin: Plugin = async ({ directory, client }) => {
  const pluginClient = client as PluginClient
  installBundledSkill(directory)
  // Scheduling starts off; `tasks_start` turns it on for this runtime.
  registerTaskRuntimeClient(directory, pluginClient)

  return {
    ...createPermissionHook(directory),
    event: createEventHook(pluginClient, directory).event,
    tool: { ...createWorkerTools(directory), ...createTaskTools(directory), ...createDebugTool(directory) },
  }
}

export default TasksPlugin
