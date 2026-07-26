import { existsSync, mkdirSync, readFileSync } from "node:fs"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { stateDir } from "./state"
import { latestSessionForTask } from "./task-session"
import type { PluginClient } from "./types"
import { log, resolveProjectRoot, tasksFilePath } from "./worker/common"
import { findTask } from "./worker/select"
import { runTask, runTaskBySlug } from "./worker/run"

export async function runWorker(directory: string, client: PluginClient, taskSlug?: string): Promise<void> {
  const projectRoot = resolveProjectRoot(directory)
  const tasksFile = tasksFilePath(projectRoot)
  if (!existsSync(tasksFile)) return
  mkdirSync(stateDir(projectRoot), { recursive: true })

  if (taskSlug) {
    await runTaskBySlug(projectRoot, taskSlug, client)
    return
  }

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const selected = await findTask(projectRoot, parsed, client)
  if (!selected) {
    log(projectRoot, "status=idle reason=no-pending-tasks")
    return
  }

  // Reuse the same session whenever this task has one.
  const session = latestSessionForTask(projectRoot, selected.slug)
  await runTask(projectRoot, selected, content, session, client)
}
