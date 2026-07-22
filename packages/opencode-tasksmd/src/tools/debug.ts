import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { logFile, readState } from "../state"
import { schedulerExists } from "../tasks-scheduler"
import { workerAsset, workerRuntime } from "../utils"
import { findServer } from "../worker/server"
import { parseEvery } from "../config"

export function createDebugTool(directory: string) {
  return {
    tasks_debug: tool({
      description: "Diagnose the tasks pipeline: board, state, scheduler registration, worker asset, server connection, next task, and recent worker log.",
      args: {},
      async execute() {
        const lines: string[] = []
        const boardPath = path.join(directory, "TASKS.md")

        if (!existsSync(boardPath)) {
          return "board: no TASKS.md — the plugin is idle in this project"
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
        lines.push(`runtime: ${process.versions.bun ? "bun (opencode CLI host)" : "node (desktop host)"} → ${runtime.program}`)

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

        return lines.join("\n")
      },
    }),
  }
}
