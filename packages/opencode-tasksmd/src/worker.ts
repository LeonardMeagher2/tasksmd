import { existsSync, mkdirSync, readFileSync } from "node:fs"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { parseEvery } from "./config"
import { readState, stateDir, writeState } from "./state"
import { installTaskWorker } from "./tasks-scheduler"
import { loadTaskConfig, log, projectRoot, tasksFile } from "./worker/common"
import { findServer } from "./worker/server"
import { findTask } from "./worker/select"
import { runTask, runTaskBySlug } from "./worker/run"

async function main(): Promise<void> {
  if (!existsSync(tasksFile)) return
  mkdirSync(stateDir(projectRoot), { recursive: true })

  const taskArgIndex = process.argv.indexOf("--task")
  if (taskArgIndex !== -1 && taskArgIndex + 1 < process.argv.length) {
    await runTaskBySlug(process.argv[taskArgIndex + 1])
    return
  }

  const server = await findServer()
  log(server ? `server=attached url=${server.url}` : "server=standalone reason=no-matching-server")

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const selected = findTask(parsed)
  if (!selected) {
    log("status=idle reason=no-pending-tasks")
    return
  }

  await runTask(selected, content, "")

  // A completed run may have introduced a per-task schedule — install it once.
  const interval = parseEvery(loadTaskConfig(content, selected).every, 0)
  if (interval > 0) {
    const state = readState(projectRoot)
    if (!state.schedulers[selected.slug]) {
      await installTaskWorker(projectRoot, selected.slug, interval)
      state.schedulers[selected.slug] = interval
      writeState(projectRoot, state)
      log(`task=${selected.slug} scheduler=installed interval=${interval}s`)
    }
  }
}

await main()
