import { type Plugin } from "@opencode-ai/plugin"

import { createConfigHook } from "./hooks/config"
import { createEventHook } from "./hooks/event"
import { createPermissionHook } from "./hooks/permission"
import { createDebugTool } from "./tools/debug"
import { createTaskTools } from "./tools/task"
import { createWorkerTools } from "./tools/worker"
import { installWorkerAsset, hasTasksFile } from "./utils"
import { reconcileTaskSchedulers } from "./tasks-runtime"
import { readState, writeState } from "./state"

export const TasksPlugin: Plugin = async ({ directory, client, serverUrl }) => {
  installWorkerAsset(directory)

  // Remember where the host's server lives so scheduled workers can attach later.
  if (serverUrl) {
    const state = readState(directory)
    const url = String(serverUrl)
    const password = process.env.OPENCODE_SERVER_PASSWORD || undefined
    if (state.server_url !== url || state.server_password !== password) {
      state.server_url = url
      state.server_password = password
      writeState(directory, state)
    }
  }

  const server = serverUrl ? String(serverUrl) : undefined
  if (hasTasksFile(directory)) await reconcileTaskSchedulers(directory)

  return {
    ...createConfigHook(),
    ...createPermissionHook(directory),
    event: createEventHook(client, directory, server).event,
    tool: { ...createWorkerTools(directory, server), ...createTaskTools(directory), ...createDebugTool(directory) },
  }
}

export default TasksPlugin
