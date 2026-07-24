import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { parseEvery } from "./config"
import { logFile, readState } from "./state"
import { schedulerExists } from "./tasks-scheduler"
import { workerAsset, workerRuntime } from "./utils"
import { findServer } from "./worker/server"

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
lines.push(`  every: ${every > 0 ? `${every}s` : "disabled"}  max_active: ${parsed.frontmatter.max_active ?? 1}`)
const counts: Record<string, number> = {}
for (const t of parsed.roots) counts[t.state] = (counts[t.state] ?? 0) + 1
lines.push(`  roots: ${parsed.roots.length} (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(", ")})`)

const state = readState(directory)
lines.push(`state: ${Object.keys(state.schedulers).length} scheduler(s), ${Object.keys(state.tasks).length} task record(s)`)
for (const [slug, interval] of Object.entries(state.schedulers)) {
  const registered = await schedulerExists(directory, slug)
  lines.push(`  scheduler ${slug || "(board)"}: every ${interval}s, registered=${registered}`)
}

const asset = workerAsset(directory)
lines.push(`worker asset: ${existsSync(asset) ? asset : `MISSING (${asset})`}`)

const runtime = workerRuntime()
lines.push(`runtime: ${process.versions.bun ? "bun (opencode CLI host)" : "node (desktop host)"} \u2192 ${runtime.program}`)

const server = await findServer(directory)
lines.push(`server: ${server ? `attached ${server.url}` : "standalone (no reachable opencode server)"}`)
if (state.server_url) lines.push(`  recorded: ${state.server_url} (password ${state.server_password ? "set" : "not set"})`)

const next = parsed.roots.find((t) => t.state === "pending")
lines.push(`next pending: ${next ? next.slug : "none"}`)

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
