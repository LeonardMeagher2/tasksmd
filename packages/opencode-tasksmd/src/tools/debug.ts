import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { boardSchedules, scheduleDetail, taskWatches } from "../schedule"
import { logFile, readState } from "../state"
import { taskRuntimeConnected, taskSchedulersEnabled } from "../tasks-runtime"
import { parseEvery, parseMaxActive } from "../config"

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
        const limit = parseMaxActive(parsed.frontmatter.max_active)
        lines.push(`  every: ${every > 0 ? `${every}s` : "disabled"}  max_active: ${Number.isFinite(limit) ? limit : "unlimited"}`)
        const counts: Record<string, number> = {}
        for (const t of parsed.roots) counts[t.state] = (counts[t.state] ?? 0) + 1
        lines.push(`  roots: ${parsed.roots.length} (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(", ")})`)

        const state = readState(directory)
        const configured = boardSchedules(directory, parsed)
        lines.push(`runtime scheduler: ${taskSchedulersEnabled(directory) ? "enabled" : "disabled"}`)
        lines.push(`state: ${Object.keys(configured).length} configured scheduler(s), ${Object.keys(state.tasks).length} task record(s)`)
        for (const t of parsed.roots) {
          if (t.state !== "blocked") continue
          const reason = state.tasks[t.slug]?.blocked_reason
          lines.push(`  blocked ${t.slug}${reason ? `: ${reason}` : ""}`)
        }
        for (const [slug, interval] of Object.entries(configured)) {
          lines.push(`  scheduler ${slug || "(board)"}: every ${interval}s${scheduleDetail(state, slug, interval)}`)
        }
        const watches = taskWatches(directory, parsed)
        for (const [slug, config] of Object.entries(watches)) {
          const changed = state.tasks[slug]?.has_watch_changed === true
          lines.push(`  watcher ${slug}: watch ${config.paths.join(", ")}  ignore: ${config.ignore.join(", ")}  change pending: ${changed ? "yes" : "no"}`)
        }

        lines.push(`runtime: ${process.versions.bun ? "bun (opencode CLI host)" : "node (desktop host)"}`)
        lines.push(`session api: ${taskRuntimeConnected(directory) ? "connected" : "unavailable"}`)

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

        return lines.join("\n")
      },
    }),
  }
}
