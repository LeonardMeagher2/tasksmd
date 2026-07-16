import { type Plugin, tool } from "@opencode-ai/plugin"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { installWorker, uninstallWorker, isWorkerInstalled } from "./tasks-scheduler"
import { tryRunTask } from "./tasks-runtime"

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const bundledSkillsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "skills")

function opencodePath(): string {
  try {
    const command = process.platform === "win32" ? "where.exe" : "sh"
    const args = process.platform === "win32" ? ["opencode"] : ["-lc", "command -v opencode"]
    return execFileSync(command, args, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]
  } catch {
    return ""
  }
}

function writeTaskConfig(directory: string, activeServerUrl?: string): void {
  const tasksDir = path.join(directory, ".tasks")
  const binary = opencodePath()
  if (!binary) return
  const configPath = path.join(tasksDir, "config")
  const previous = existsSync(configPath) ? readFileSync(configPath, "utf-8") : ""
  const previousUrl = previous.match(/^server_url=(.*)$/m)?.[1]?.trim() || ""
  const serverUrl = activeServerUrl || process.env.OPENCODE_TASKS_SERVER_URL?.trim() || previousUrl
  writeFileSync(
    configPath,
    `opencode_path=${binary}\nplatform=${process.platform}\n${serverUrl ? `server_url=${serverUrl}\n` : ""}`,
    "utf-8",
  )
}

export const TasksPlugin: Plugin = async ({ directory, client, serverUrl }) => {
  // Ensure .tasks/ has a gitignore so state and logs stay local
  const tasksDir = path.join(directory, ".tasks")
  mkdirSync(tasksDir, { recursive: true })
  writeTaskConfig(directory, serverUrl?.toString())
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
    debounceTimers.set(directory, setTimeout(async () => {
      debounceTimers.delete(directory)
      if (client) {
        try { await tryRunTask(client, directory); return } catch { /* fall through */ }
      }
      spawn(opencodePath(), ["run", path.join(directory, ".opencode", "tasks", "worker.ts")], {
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
        description: "Executes TASKS.md work items without spawning subagents.",
        prompt: `You are the project task runner.

Execute the assigned task now in the current project using your tools. Do not only explain or make a plan. Do not ask normal clarification questions; choose a sensible minimal result and proceed. Inspect relevant files first. Verify the result before finishing. Do not spawn subagents. For linked tasks, read the referenced file and treat it as one task. Do not edit .tasks/.state files. After verified completion, mark the exact top-level task [x] in TASKS.md. If blocked, mark it [!] and state the blocker. Leave [~] only when work remains.`,
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
        onFileEdited()
      }
    },
  }
}

export default TasksPlugin
