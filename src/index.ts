import { type Plugin, tool } from "@opencode-ai/plugin"
import { execFileSync, spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { installTaskWorker, uninstallTaskWorker } from "./tasks-scheduler"

import { frontmatterData, parseEvery } from "./task-config"
import { parseChecklist } from "./checklist"
import { readState, writeState } from "./state"

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



function desiredSchedulers(directory: string): Record<string, number> {
  const tasksFile = path.join(directory, "TASKS.md")
  if (!existsSync(tasksFile)) return {}

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const result: Record<string, number> = {}

  const boardEvery = parseEvery(parsed.frontmatter.every, 0)
  if (boardEvery > 0) result[""] = boardEvery

  for (const task of parsed.tasks) {
    if (!task.link) continue
    const linkedFile = path.join(directory, task.link.path)
    const linkedContent = existsSync(linkedFile) ? readFileSync(linkedFile, "utf-8") : ""
    const linkedConfig = linkedContent ? frontmatterData(linkedContent) : {}
    const interval = parseEvery(linkedConfig.every, 0)
    if (interval > 0) result[task.slug] = interval
  }

  return result
}

async function reconcileTaskSchedulers(directory: string): Promise<void> {
  const desired = desiredSchedulers(directory)
  const state = readState(directory)
  const installed = state.schedulers

  const desiredSlugs = new Set(Object.keys(desired))

  for (const slug of Object.keys(installed)) {
    if (!desiredSlugs.has(slug) || installed[slug] !== desired[slug]) {
      await uninstallTaskWorker(directory, slug)
    }
  }

  for (const slug of desiredSlugs) {
    if (installed[slug] === undefined || installed[slug] !== desired[slug]) {
      await installTaskWorker(directory, slug, desired[slug])
    }
  }

  state.schedulers = desired
  writeState(directory, state)
}

function spawnWorker(directory: string): void {
  const worker = path.join(directory, ".opencode", "tasks", bundledWorker.endsWith(".js") ? "worker.js" : "worker.ts")
  spawn(opencodePath(), ["run", worker], {
    cwd: directory,
    windowsHide: true,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, BUN_BE_BUN: "1" },
  }).unref()
}

export const TasksPlugin: Plugin = async ({ directory, client }) => {
  installWorkerAsset(directory)
  if (existsSync(path.join(directory, "TASKS.md"))) await reconcileTaskSchedulers(directory)

  const onFileEdited = (): void => {
    const existing = debounceTimers.get(directory)
    if (existing) clearTimeout(existing)
    debounceTimers.set(directory, setTimeout(async () => {
      debounceTimers.delete(directory)
      await reconcileTaskSchedulers(directory)
      spawnWorker(directory)
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
      tasks_start: tool({
        description: "Reconcile board and per-task schedulers, then run any pending work.",
        args: {},
        async execute(_args, ctx) {
          const dir = ctx.directory || directory
          await reconcileTaskSchedulers(dir)
          spawnWorker(dir)
          return "Schedulers reconciled."
        },
      }),

      tasks_remove_schedules: tool({
        description: "Remove all board and per-task schedulers for this project.",
        args: {},
        async execute(_args, ctx) {
          const dir = ctx.directory || directory
          const state = readState(dir)
          for (const slug of Object.keys(state.schedulers)) {
            await uninstallTaskWorker(dir, slug)
          }
          state.schedulers = {}
          writeState(dir, state)
          return "All schedulers removed."
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
