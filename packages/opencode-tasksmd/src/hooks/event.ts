import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { tryRunTask } from "../tasks-runtime"
import { readState } from "../state"
import { showToast } from "./toast"
import type { PluginClient } from "../types"

const DEBOUNCE_MS = 5000
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const blockedCache = new Map<string, Set<string>>()
const toastedRuns = new Set<string>()

function boardPath(directory: string): string {
  return path.join(directory, "TASKS.md")
}

/** True when the changed file is the board or a linked task file. */
function isWorkFile(directory: string, file: string): boolean {
  const resolved = path.resolve(directory, file)
  if (resolved === boardPath(directory)) return true
  if (!file.endsWith(".md")) return false
  try {
    const parsed = parseChecklist(readFileSync(boardPath(directory), "utf-8"))
    return parsed.roots.some((t) => t.link && path.resolve(directory, t.link.path) === resolved)
  } catch {
    return false
  }
}

async function toastNewBlocked(client: PluginClient, directory: string): Promise<void> {
  try {
    const parsed = parseChecklist(readFileSync(boardPath(directory), "utf-8"))
    const blocked = new Set(parsed.roots.filter((t) => t.state === "blocked").map((t) => t.slug))
    const previous = blockedCache.get(directory) ?? new Set<string>()
    const state = readState(directory)
    for (const slug of blocked) {
      if (!previous.has(slug)) {
        const reason = state.tasks[slug]?.blocked_reason
        await showToast(client, reason ? `Task blocked: ${slug} — ${reason}` : `Task blocked: ${slug}`, "warning", "tasksmd")
      }
    }
    blockedCache.set(directory, blocked)
  } catch {
    // Board may be mid-write; the next change retries.
  }
}

async function toastFinishedSession(client: PluginClient, directory: string, sessionID: string): Promise<void> {
  // The worker records its result just as the session goes idle — give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const state = readState(directory)
  for (const [slug, run] of Object.entries(state.tasks)) {
    if (run.session_id !== sessionID) continue
    if (typeof run.exit_code !== "number") continue
    const outcome = run.exit_code === 0 ? "success" : "failed"
    const key = `${slug}:${run.last_completed ?? ""}:${run.exit_code}`
    if (toastedRuns.has(key)) return
    if (toastedRuns.size > 500) toastedRuns.clear()
    toastedRuns.add(key)
    const variant = run.exit_code === 0 ? "success" : "error"
    await showToast(client, `Task ${slug} ${outcome}`, variant, "tasksmd")
    return
  }
}

export function createEventHook(client: PluginClient, directory: string) {
  return {
    event: async ({ event }: { event: { type?: string; properties?: Record<string, unknown> } }) => {
      if (event.type === "session.idle") {
        const sessionID = event.properties?.sessionID
        if (typeof sessionID === "string" && sessionID) await toastFinishedSession(client, directory, sessionID)
        return
      }

      if (event.type !== "file.edited" && event.type !== "file.watcher.updated") return
      if (!existsSync(boardPath(directory))) return
      const file = event.properties?.file
      if (typeof file !== "string" || !isWorkFile(directory, file)) return

      await toastNewBlocked(client, directory)

      const existing = debounceTimers.get(directory)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        debounceTimers.delete(directory)
        tryRunTask(directory)
      }, DEBOUNCE_MS)
      timer.unref?.()
      debounceTimers.set(directory, timer)
    },
  }
}
