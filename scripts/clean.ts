import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"

import { logFile, readState, stateDir } from "../packages/opencode-tasksmd/src/state"
import { uninstallTaskWorker } from "../packages/opencode-tasksmd/src/tasks-scheduler"

/**
 * Full cleanup of tasksmd runtime state for this project:
 * stray worker processes, OS schedulers, state.json, worker logs, worker
 * assets, and any `task:*` sessions left on the server. TASKS.md itself is
 * never touched.
 */
const dir = process.cwd()

// 1. Stop stray workers (Windows: match on the command line; elsewhere: best-effort pkill).
if (process.platform === "win32") {
  const result = Bun.spawnSync([
    "powershell", "-Command",
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'worker\\.mjs' } | Select-Object -ExpandProperty ProcessId",
  ])
  for (const pid of result.stdout.toString().trim().split(/\r?\n/).map(Number).filter(Boolean)) {
    try { process.kill(pid); console.log(`stopped worker pid ${pid}`) } catch { /* already gone */ }
  }
} else {
  Bun.spawnSync(["pkill", "-f", "worker.mjs"])
}

// 2. Remove every registered scheduler.
const state = readState(dir)
for (const slug of Object.keys(state.schedulers)) {
  console.log(await uninstallTaskWorker(dir, slug))
}

// 3. Delete task sessions left on the server, when it is reachable.
if (state.server_url && state.server_password) {
  try {
    const headers = { Authorization: `Basic ${Buffer.from(`opencode:${state.server_password}`).toString("base64")}` }
    const base = state.server_url.replace(/\/+$/, "")
    const res = await fetch(`${base}/session`, { headers })
    const sessions = (await res.json()) as Array<{ id: string; title?: string }>
    for (const session of sessions.filter((s) => (s.title ?? "").startsWith("task:"))) {
      const del = await fetch(`${base}/session/${session.id}`, { method: "DELETE", headers })
      console.log(`${del.ok ? "deleted" : "FAILED"} session ${session.id} ${session.title}`)
    }
  } catch {
    console.log("server not reachable — skipping session cleanup")
  }
}

// 4. State, logs, and installed worker assets.
rmSync(stateDir(dir), { recursive: true, force: true })
rmSync(path.dirname(logFile(dir)), { recursive: true, force: true })
rmSync(path.join(dir, ".opencode", "tasks"), { recursive: true, force: true })
console.log("removed state, logs, and worker assets")

console.log("clean. Run `bun run dev` and restart opencode to start fresh.")
