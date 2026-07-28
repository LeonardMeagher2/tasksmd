import path from "node:path"

import { type Plugin } from "@opencode-ai/plugin"

import { createEventHook } from "./hooks/event"
import { createDebugTool } from "./tools/debug"
import { createTaskTools } from "./tools/task"
import { createWorkerTools } from "./tools/worker"
import { registerTaskRuntimeClient } from "./tasks-runtime"
import type { PluginClient } from "./types"
import { installBundledSkill } from "./utils"
import { resolveProjectRoot } from "./worker/common"

export const TasksPlugin: Plugin = async ({ directory, client }) => {
  const pluginClient = client as PluginClient

  // A worktree instance shares the main checkout's board and state: it exists
  // only to give task sessions their tools. Schedulers, watchers, and control
  // tools belong to the main instance — a second one would run the worktree's
  // stale board and double-fire session handlers.
  if (resolveProjectRoot(directory) !== path.resolve(directory)) {
    return { tool: { ...createTaskTools(directory) } }
  }

  installBundledSkill(directory)
  // Scheduling starts off; `tasks_start` turns it on for this runtime.
  registerTaskRuntimeClient(directory, pluginClient)

  return {
    event: createEventHook(pluginClient, directory).event,
    tool: { ...createWorkerTools(directory), ...createTaskTools(directory), ...createDebugTool(directory) },
  }
}

export default TasksPlugin
