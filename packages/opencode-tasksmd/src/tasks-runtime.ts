import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist, frontmatter } from "@leonardmeagher2/tasksmd"
import { parseEvery } from "./config"
import { readState, writeState } from "./state"
import { installTaskWorker, uninstallTaskWorker } from "./tasks-scheduler"
import { opencodePath, workerAsset } from "./utils"

function desiredSchedulers(directory: string): Record<string, number> {
  const tasksFile = path.join(directory, "TASKS.md")
  if (!existsSync(tasksFile)) return {}

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const result: Record<string, number> = {}

  const boardEvery = parseEvery(parsed.frontmatter.every, 0)
  if (boardEvery > 0) result[""] = boardEvery

  for (const task of parsed.roots) {
    if (!task.link) continue
    const linkedFile = path.join(directory, task.link.path)
    const linkedContent = existsSync(linkedFile) ? readFileSync(linkedFile, "utf-8") : ""
    const linkedConfig = linkedContent ? frontmatter(linkedContent) : {}
    const interval = parseEvery(linkedConfig.every, 0)
    if (interval > 0) result[task.slug] = interval
  }

  return result
}

export async function reconcileTaskSchedulers(directory: string): Promise<void> {
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

export function spawnWorker(directory: string): void {
  spawn(opencodePath(), ["run", workerAsset(directory)], {
    cwd: directory,
    windowsHide: true,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, BUN_BE_BUN: "1" },
  }).unref()
}

export async function tryRunTask(directory: string): Promise<void> {
  await reconcileTaskSchedulers(directory)
  spawnWorker(directory)
}
