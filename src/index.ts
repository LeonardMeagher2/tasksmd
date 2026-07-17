import { type Plugin, tool } from "@opencode-ai/plugin"
import { execFileSync, spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { installWorker, uninstallWorker, isWorkerInstalled } from "./tasks-scheduler"
import { tryRunTask } from "./tasks-runtime"

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const bundledSkillsDir = path.join(pluginDir, "skills")
const bundledWorker = existsSync(path.join(pluginDir, "worker.js"))
  ? path.join(pluginDir, "worker.js")
  : path.join(pluginDir, "worker.ts")

function opencodePath(): string {
  try {
    const command = process.platform === "win32" ? "where.exe" : "sh"
    const args = process.platform === "win32" ? ["opencode"] : ["-lc", "command -v opencode"]
    return execFileSync(command, args, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]
  } catch {
    return ""
  }
}

function installWorkerAsset(directory: string): void {
  const targetName = bundledWorker.endsWith(".js") ? "worker.js" : "worker.ts"
  const target = path.join(directory, ".opencode", "tasks", targetName)
  if (path.resolve(target) === path.resolve(bundledWorker)) return
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(bundledWorker, target)
}

function hasTasksFile(directory: string): boolean {
  return existsSync(path.join(directory, "TASKS.md"))
}

export const TasksPlugin: Plugin = async ({ directory, client }) => {
  const schedulerEnabled = hasTasksFile(directory)
  installWorkerAsset(directory)
  if (schedulerEnabled && !isWorkerInstalled(directory)) {
    installWorker(directory)
  }

  const onFileEdited = (): void => {
    if (!schedulerEnabled) return
    const existing = debounceTimers.get(directory)
    if (existing) clearTimeout(existing)
    debounceTimers.set(directory, setTimeout(async () => {
      debounceTimers.delete(directory)
      if (client) {
        try { await tryRunTask(client, directory); return } catch { /* fall through */ }
      }
      const worker = path.join(directory, ".opencode", "tasks", bundledWorker.endsWith(".js") ? "worker.js" : "worker.ts")
      spawn(opencodePath(), ["run", worker], {
        cwd: directory,
        stdio: "ignore",
        detached: true,
        env: { ...process.env, BUN_BE_BUN: "1" },
      }).unref()
    }, 5000))
  }

  return {
    config: (config) => {
      config.skills ??= {}
      config.skills.paths ??= []
      if (!config.skills.paths.includes(bundledSkillsDir)) config.skills.paths.push(bundledSkillsDir)
      config.agent ??= {}
      config.agent["task-runner"] = {
        ...(config.agent["task-runner"] ?? {}),
        mode: "primary",
        description: "Executes TASKS.md work items in the current project.",
        prompt: `You are the project task runner.

The task board is TASKS.md. Linked task files live wherever their link points. Worker state is managed outside the project. Work directly on the assigned task in the current project using your tools. Focus on making and verifying the requested changes. Resolve routine ambiguity with a sensible minimal result and proceed. Inspect relevant files first. For linked tasks, read the referenced file and treat it as one task. Keep task status accurate: mark the exact top-level task [x] after verified completion, [!] with the blocker when blocked, and [~] while work remains.`,
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
        onFileEdited()
      }
    },
  }
}

export default TasksPlugin
