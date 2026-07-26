import { rmSync } from "node:fs"

import { logFile, stateFile } from "../packages/opencode-tasksmd/src/state"

/**
 * Full cleanup of tasksmd runtime state for this project:
 * state.json and worker logs. TASKS.md itself is never touched.
 */
const dir = process.cwd()

// 1. State and logs.
rmSync(stateFile(dir), { force: true })
rmSync(logFile(dir), { force: true })
console.log("removed state and logs")

console.log("clean. Run `bun run dev` and restart opencode to start fresh.")
