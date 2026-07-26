import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { boardSchedules } from "./schedule"
import type { PluginClient } from "./types"
import { runWorker } from "./worker"
import { log } from "./worker/common"

type SchedulerSlug = string

type RuntimeSchedulerState = {
  enabled: boolean
  timers: Map<SchedulerSlug, ReturnType<typeof setInterval>>
  intervals: Record<SchedulerSlug, number>
  client?: PluginClient
  inFlight?: Promise<void>
}

const runtimeSchedulers = new Map<string, RuntimeSchedulerState>()

function runtimeState(directory: string): RuntimeSchedulerState {
  const key = path.resolve(directory)
  const existing = runtimeSchedulers.get(key)
  if (existing) return existing
  const created: RuntimeSchedulerState = { enabled: false, timers: new Map(), intervals: {} }
  runtimeSchedulers.set(key, created)
  return created
}

export function registerTaskRuntimeClient(directory: string, client: PluginClient): void {
  runtimeState(directory).client = client
}

function clearRuntimeTimers(directory: string): void {
  const state = runtimeState(directory)
  for (const timer of state.timers.values()) clearInterval(timer)
  state.timers.clear()
  state.intervals = {}
}

export function configuredSchedulers(directory: string): Record<string, number> {
  const tasksFile = path.join(directory, "TASKS.md")
  if (!existsSync(tasksFile)) return {}
  return boardSchedules(directory, parseChecklist(readFileSync(tasksFile, "utf-8")))
}

function syncRuntimeTimers(directory: string, desired: Record<string, number>): void {
  const state = runtimeState(directory)

  for (const slug of state.timers.keys()) {
    if (!(slug in desired) || state.intervals[slug] !== desired[slug]) {
      const timer = state.timers.get(slug)
      if (timer) clearInterval(timer)
      state.timers.delete(slug)
      delete state.intervals[slug]
    }
  }

  for (const [slug, interval] of Object.entries(desired)) {
    if (interval <= 0) continue
    if (state.timers.has(slug)) continue
    const timer = setInterval(() => {
      spawnWorker(directory, slug || undefined)
    }, interval * 1000)
    // A pending tick must never be the reason the host stays alive.
    timer.unref?.()
    state.timers.set(slug, timer)
    state.intervals[slug] = interval
  }
}

/** Bring the timers in line with the board. A no-op while schedulers are off. */
export function reconcileTaskSchedulers(directory: string): void {
  if (!runtimeState(directory).enabled) return
  syncRuntimeTimers(directory, configuredSchedulers(directory))
}

/**
 * Start a worker run unless one is already going. Runs are serialised per
 * project so a scheduled tick can never overlap a run it would fight with.
 */
export function spawnWorker(directory: string, taskSlug?: string): void {
  const state = runtimeState(directory)
  const client = state.client
  if (!client) return
  if (state.inFlight) {
    log(directory, `task=${taskSlug ?? "(board)"} action=skip reason=run-in-flight`)
    return
  }
  state.inFlight = runWorker(directory, client, taskSlug)
    .catch((error) => {
      log(directory, `task=${taskSlug ?? "(board)"} status=failed reason=${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => {
      state.inFlight = undefined
    })
}

export function tryRunTask(directory: string): void {
  if (!runtimeState(directory).enabled) return
  reconcileTaskSchedulers(directory)
  spawnWorker(directory)
}

export function startTaskSchedulers(directory: string): void {
  const state = runtimeState(directory)
  state.enabled = true
  syncRuntimeTimers(directory, configuredSchedulers(directory))
  spawnWorker(directory)
}

export function stopTaskSchedulers(directory: string): void {
  const state = runtimeState(directory)
  state.enabled = false
  clearRuntimeTimers(directory)
}

export function taskSchedulersEnabled(directory: string): boolean {
  return runtimeState(directory).enabled
}

export function taskRuntimeConnected(directory: string): boolean {
  return Boolean(runtimeState(directory).client)
}
