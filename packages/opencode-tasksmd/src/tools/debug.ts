import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { boardSchedules } from "../schedule"
import { logFile, readState } from "../state"
import { taskRuntimeConnected, taskSchedulersEnabled } from "../tasks-runtime"
import { parseEvery } from "../config"

export function createDebugTool(directory: string) {
  return {
    tasks_debug: tool({
      description: "Diagnose the tasks pipeline: board, state, runtime scheduler status, session API connection, next task, and recent worker log.",
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
        const configured = boardSchedules(directory, parsed)
        lines.push(`runtime scheduler: ${taskSchedulersEnabled(directory) ? "enabled" : "disabled"}`)
        lines.push(`state: ${Object.keys(configured).length} configured scheduler(s), ${Object.keys(state.tasks).length} task record(s)`)
        for (const [slug, interval] of Object.entries(configured)) {
          lines.push(`  scheduler ${slug || "(board)"}: every ${interval}s`)
        }

        lines.push(`runtime: ${process.versions.bun ? "bun (opencode CLI host)" : "node (desktop host)"}`)
        lines.push(`session api: ${taskRuntimeConnected(directory) ? "connected" : "unavailable"}`)

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
