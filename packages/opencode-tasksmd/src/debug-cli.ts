import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { parseEvery, parseMaxActive } from "./config"
import { boardSchedules, scheduleDetail } from "./schedule"
import { logFile, readState } from "./state"

const directory = resolveDir()
const lines: string[] = []
const boardPath = path.join(directory, "TASKS.md")

if (!existsSync(boardPath)) {
  console.log("board: no TASKS.md — the plugin is idle in this project")
  process.exit(0)
}

const content = readFileSync(boardPath, "utf-8")
const parsed = parseChecklist(content)
const every = parseEvery(parsed.frontmatter.every, 0)
lines.push(`board: ${boardPath}`)
const limit = parseMaxActive(parsed.frontmatter.max_active)
lines.push(`  every: ${every > 0 ? `${every}s` : "disabled"}  max_active: ${Number.isFinite(limit) ? limit : "unlimited"}`)
const counts: Record<string, number> = {}
for (const t of parsed.roots) counts[t.state] = (counts[t.state] ?? 0) + 1
lines.push(`  roots: ${parsed.roots.length} (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(", ")})`)

// Scheduler and session-API status live in the OpenCode runtime; this CLI runs
// outside it, so it reports only what is on disk. Use `tasks_debug` for the rest.
const state = readState(directory)
const configured = boardSchedules(directory, parsed)
lines.push(`state: ${Object.keys(configured).length} configured scheduler(s), ${Object.keys(state.tasks).length} task record(s)`)
for (const [slug, interval] of Object.entries(configured)) {
  lines.push(`  scheduler ${slug || "(board)"}: every ${interval}s${scheduleDetail(state, slug, interval)}`)
}

// The board only: what the worker picks also depends on session status,
// schedules and `max_active`, none of which this line accounts for.
const next = parsed.roots.find((t) => t.state === "pending")
lines.push(`first pending on the board: ${next ? next.slug : "none"}`)

const log = logFile(directory)
if (existsSync(log)) {
  const tail = readFileSync(log, "utf-8").trim().split("\n").slice(-10)
  lines.push(`worker log (${log}):`)
  lines.push(...tail.map((l) => `  ${l}`))
} else {
  lines.push(`worker log: none yet (${log})`)
}

console.log(lines.join("\n"))

function resolveDir(): string {
  const idx = process.argv.indexOf("--dir")
  if (idx !== -1 && idx + 1 < process.argv.length) return path.resolve(process.argv[idx + 1])
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0]
  return positional ? path.resolve(positional) : process.cwd()
}
