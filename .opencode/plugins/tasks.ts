import { type Plugin, tool } from "@opencode-ai/plugin"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { installWorker, uninstallWorker, isWorkerInstalled } from "./tasks-scheduler"
import { tryRunTask } from "./tasks-runtime"

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const debugCache = new Map<string, boolean>()

function opencodePath(): string {
  try {
    const command = process.platform === "win32" ? "where.exe" : "sh"
    const args = process.platform === "win32" ? ["opencode"] : ["-lc", "command -v opencode"]
    return execFileSync(command, args, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]
  } catch {
    return ""
  }
}

function writeTaskConfig(directory: string): void {
  const tasksDir = path.join(directory, ".tasks")
  const binary = opencodePath()
  if (!binary) return
  const configPath = path.join(tasksDir, "config")
  const previous = existsSync(configPath) ? readFileSync(configPath, "utf-8") : ""
  const previousUrl = previous.match(/^server_url=(.*)$/m)?.[1]?.trim() || ""
  const serverUrl = process.env.OPENCODE_TASKS_SERVER_URL?.trim() || previousUrl
  writeFileSync(
    configPath,
    `opencode_path=${binary}\nplatform=${process.platform}\n${serverUrl ? `server_url=${serverUrl}\n` : ""}`,
    "utf-8",
  )
}

function debug(dir: string, msg: string): void {
  const dbgFile = path.join(dir, ".tasks", ".debug")
  let enabled = debugCache.get(dir)
  if (enabled === undefined) {
    enabled = existsSync(dbgFile)
    debugCache.set(dir, enabled)
  }
  if (enabled) process.stderr.write(`[tasks] ${msg}\n`)
}

export const TasksPlugin: Plugin = async ({ directory, client }) => {
  debug(directory, "plugin loaded")
  // Ensure .tasks/ has a gitignore so state and logs stay local
  const tasksDir = path.join(directory, ".tasks")
  mkdirSync(tasksDir, { recursive: true })
  writeTaskConfig(directory)
  const gi = path.join(tasksDir, ".gitignore")
  if (!existsSync(gi)) {
    writeFileSync(gi, "worker.log\n.state/\nconfig\n", "utf-8")
  } else {
    const ignored = readFileSync(gi, "utf-8").split(/\r?\n/)
    if (!ignored.includes("config")) writeFileSync(gi, `${ignored.join("\n").trimEnd()}\nconfig\n`, "utf-8")
  }

  if (!isWorkerInstalled(directory)) {
    installWorker(directory)
  }

  const onFileEdited = (): void => {
    const existing = debounceTimers.get(directory)
    if (existing) clearTimeout(existing)
    debug(directory, "file edited, debouncing 5s")
    debounceTimers.set(directory, setTimeout(async () => {
      debounceTimers.delete(directory)
      if (client) {
        debug(directory, "attempting in-process run via ctx.client.session")
        try { await tryRunTask(client, directory); return } catch (e) { debug(directory, `in-process run failed: ${e}`) }
      }
      debug(directory, "falling back to worker.sh spawn")
      spawn("/bin/sh", [path.join(directory, ".opencode/tasks/worker.sh")],
        { cwd: directory, stdio: "ignore", detached: true }).unref()
    }, 5000))
  }

  return {
    config: (config: any) => {
      config.agent ??= {}
      config.agent["task-runner"] = {
        ...(config.agent["task-runner"] ?? {}),
        mode: "primary",
        description: "Executes TASKS.md work items without spawning subagents.",
        permission: {
          ...(config.agent["task-runner"]?.permission ?? {}),
          task: "deny",
        },
      }
    },
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
        debug(directory, `event: ${event.type}`)
        onFileEdited()
      }
    },
  }
}

export default TasksPlugin
