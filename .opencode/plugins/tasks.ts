import { type Plugin, tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { installWorker, uninstallWorker, isWorkerInstalled } from "./tasks-scheduler"
import { tryRunTask } from "./tasks-runtime"

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const TasksPlugin: Plugin = async ({ directory, client }) => {
  if (!isWorkerInstalled(directory)) {
    installWorker(directory)
  }

  // Ensure .tasks/ has a gitignore so state and logs stay local
  const tasksDir = path.join(directory, ".tasks")
  mkdirSync(tasksDir, { recursive: true })
  const gi = path.join(tasksDir, ".gitignore")
  if (!existsSync(gi)) {
    writeFileSync(gi, "worker.log\n.state/\n", "utf-8")
  }

  const onFileEdited = (): void => {
    const existing = debounceTimers.get(directory)
    if (existing) clearTimeout(existing)
    debounceTimers.set(directory, setTimeout(async () => {
      debounceTimers.delete(directory)
      if (client) {
        try { await tryRunTask(client, directory); return } catch { /* fall through */ }
      }
      spawn("/bin/sh", [path.join(directory, ".opencode/tasks/worker.sh")],
        { cwd: directory, stdio: "ignore", detached: true }).unref()
    }, 5000))
  }

  return {
    tool: {
      start_tasks_worker: tool({
        description: "Install or reinstall the background worker (launchd/systemd/schtasks, runs every 5 min).",
        args: {},
        async execute(_args, ctx) {
          const dir = ctx.directory || directory
          uninstallWorker(dir)
          return installWorker(dir)
        },
      }),

      stop_tasks_worker: tool({
        description: "Unload and remove the scheduler entry for the background worker.",
        args: {},
        async execute(_args, ctx) {
          const dir = ctx.directory || directory
          return uninstallWorker(dir)
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type === "file.edited" || event.type === "file.watcher.updated") {
        onFileEdited()
      }
    },
  }
}

export default TasksPlugin
