import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import type { WatchConfig } from "./config"
import { anyTriggerDue, boardSchedules, taskWatches } from "./schedule"
import { readState, updateTask } from "./state"
import type { PluginClient } from "./types"
import { startWatcher } from "./watch"
import { runWorker } from "./worker"
import { log } from "./worker/common"

type SchedulerSlug = string

type RuntimeSchedulerState = {
  enabled: boolean
  timers: Map<SchedulerSlug, ReturnType<typeof setInterval>>
  intervals: Record<SchedulerSlug, number>
  watchers: Map<SchedulerSlug, () => void>
  watchConfigs?: Record<SchedulerSlug, WatchConfig>
  client?: PluginClient
  inFlight?: Promise<void>
}

const runtimeSchedulers = new Map<string, RuntimeSchedulerState>()

function runtimeState(directory: string): RuntimeSchedulerState {
  const key = path.resolve(directory)
  const existing = runtimeSchedulers.get(key)
  if (existing) return existing
  const created: RuntimeSchedulerState = { enabled: false, timers: new Map(), intervals: {}, watchers: new Map() }
  runtimeSchedulers.set(key, created)
  return created
}

export function registerTaskRuntimeClient(directory: string, client: PluginClient): void {
  runtimeState(directory).client = client
}

function clearRuntimeHandles(directory: string): void {
  const state = runtimeState(directory)
  for (const timer of state.timers.values()) clearInterval(timer)
  state.timers.clear()
  state.intervals = {}
  for (const close of state.watchers.values()) close()
  state.watchers.clear()
  state.watchConfigs = {}
}

export function configuredSchedulers(directory: string): Record<string, number> {
  const tasksFile = path.join(directory, "TASKS.md")
  if (!existsSync(tasksFile)) return {}
  return boardSchedules(directory, parseChecklist(readFileSync(tasksFile, "utf-8")))
}

export function configuredWatchers(directory: string): Record<string, WatchConfig> {
  const tasksFile = path.join(directory, "TASKS.md")
  if (!existsSync(tasksFile)) return {}
  return taskWatches(directory, parseChecklist(readFileSync(tasksFile, "utf-8")))
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

function syncRuntimeWatchers(directory: string, desired: Record<string, WatchConfig>): void {
  const state = runtimeState(directory)

  for (const [slug, close] of state.watchers) {
    const before = JSON.stringify(state.watchConfigs?.[slug] ?? {})
    const changed = !(slug in desired) || JSON.stringify(desired[slug]) !== before
    if (changed) {
      close()
      state.watchers.delete(slug)
      delete state.watchConfigs?.[slug]
      // A replaced or removed watcher invalidates any trigger the old globs set.
      updateTask(directory, slug, { triggered: undefined })
    }
  }

  for (const [slug, config] of Object.entries(desired)) {
    if (!config.paths.length) continue
    if (state.watchers.has(slug)) continue
    const close = startWatcher(directory, slug, config, () => {
      updateTask(directory, slug, { triggered: true })
      spawnWorker(directory)
    })
    // The project root may not exist yet; leave the slug unregistered so a
    // later reconcile can retry.
    if (!close) continue
    state.watchers.set(slug, close)
    ;(state.watchConfigs ??= {})[slug] = config
  }
}

/** Bring the timers and watchers in line with the board. A no-op while schedulers are off. */
export function reconcileTaskSchedulers(directory: string): void {
  if (!runtimeState(directory).enabled) return
  syncRuntimeTimers(directory, configuredSchedulers(directory))
  syncRuntimeWatchers(directory, configuredWatchers(directory))
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

/**
 * Like tryRunTask, but only when a trigger says something happened: a watched
 * path changed or a recurring task is due. Used on session.idle so a freed
 * slot drains queued work without resuming a merely-active task in a loop.
 */
export function tryRunDueTask(directory: string): void {
  if (!runtimeState(directory).enabled) return
  reconcileTaskSchedulers(directory)
  const tasksFile = path.join(directory, "TASKS.md")
  if (!existsSync(tasksFile)) return
  const parsed = parseChecklist(readFileSync(tasksFile, "utf-8"))
  if (!anyTriggerDue(directory, parsed, readState(directory))) return
  spawnWorker(directory)
}

/**
 * Run one task now, whether or not schedulers are enabled. Goes through the
 * same per-project in-flight guard as scheduled runs, so it can never overlap
 * one. Returns false when the runtime is unavailable or a run is already going.
 */
export async function runTaskNow(directory: string, taskSlug: string): Promise<boolean> {
  const state = runtimeState(directory)
  const client = state.client
  if (!client) return false
  if (state.inFlight) return false
  const run = runWorker(directory, client, taskSlug, true)
  state.inFlight = run
    .catch((error) => {
      log(directory, `task=${taskSlug} status=failed reason=${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => {
      state.inFlight = undefined
    })
  await state.inFlight
  return true
}

export function startTaskSchedulers(directory: string): void {
  const state = runtimeState(directory)
  state.enabled = true
  syncRuntimeTimers(directory, configuredSchedulers(directory))
  syncRuntimeWatchers(directory, configuredWatchers(directory))
  spawnWorker(directory)
}

export function stopTaskSchedulers(directory: string): void {
  const state = runtimeState(directory)
  state.enabled = false
  clearRuntimeHandles(directory)
}

export function taskSchedulersEnabled(directory: string): boolean {
  return runtimeState(directory).enabled
}

export function taskRuntimeConnected(directory: string): boolean {
  return Boolean(runtimeState(directory).client)
}
