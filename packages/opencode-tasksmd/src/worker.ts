import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { frontmatter, parseChecklist } from "@leonardmeagher2/tasksmd"
import { parseEvery } from "./config"
import { readState, stateDir, writeState } from "./state"
import { installTaskWorker } from "./tasks-scheduler"
import { log, projectRoot, tasksFile } from "./worker/common"
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

  // Reuse the same session whenever this task has one.
  const session = readState(projectRoot).tasks[selected.slug]?.session || ""
  await runTask(selected, content, session)

  // A linked task file may declare its own recurring schedule — install it once.
  // The board's own `every` belongs to the board scheduler, not to this task.
  let interval = 0
  if (selected.link) {
    const linkedFile = path.join(projectRoot, selected.link.path)
    if (existsSync(linkedFile)) {
      interval = parseEvery(frontmatter(readFileSync(linkedFile, "utf-8")).every, 0)
    }
  }
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
