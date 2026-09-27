import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { parseWatch } from "./config"
import { logFile, stateFile } from "./state"
import {
  configuredSchedulers,
  configuredWatchers,
  reconcileTaskSchedulers,
  registerTaskRuntimeClient,
  spawnWorker,
  startTaskSchedulers,
  stopTaskSchedulers,
  taskRuntimeConnected,
  taskSchedulersEnabled,
  tryRunDueTask,
  tryRunTask,
} from "./tasks-runtime"
import { readState, updateTask } from "./state"

const projectDirs: string[] = []

afterEach(() => {
  while (projectDirs.length) {
    const dir = projectDirs.pop()!
    stopTaskSchedulers(dir)
    rmSync(stateFile(dir), { force: true })
    rmSync(logFile(dir), { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

function setupProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-runtime-"))
  projectDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe("configuredSchedulers", () => {
  test("reads board and linked task every values", () => {
    const dir = setupProject({
      "TASKS.md": "---\nevery: 60\n---\n- [ ] [Repeat docs](docs/repeat.md)\n- [ ] [One-off](docs/once.md)\n",
      "docs/repeat.md": "---\nevery: 30\n---\nrepeat\n",
      "docs/once.md": "notes\n",
    })

    expect(configuredSchedulers(dir)).toEqual({ "": 60, "repeat-docs": 30 })
  })

  test("returns empty when TASKS.md is missing", () => {
    const dir = setupProject({})
    expect(configuredSchedulers(dir)).toEqual({})
  })
})

describe("configuredWatchers", () => {
  test("reads watch globs from linked task files", () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n- [ ] [One-off](docs/once.md)\n",
      "docs/rebuild.md": "---\nwatch:\n  - src/**\n---\nrebuild\n",
      "docs/once.md": "notes\n",
    })
    expect(configuredWatchers(dir)).toEqual({ rebuild: parseWatch("src/**") })
  })

  test("returns empty when TASKS.md is missing", () => {
    const dir = setupProject({})
    expect(configuredWatchers(dir)).toEqual({})
  })
})

describe("watch-triggered runs", () => {
  test("a watched change marks the task changed and dispatches it", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
      "src/app.ts": "v1\n",
    })

    let promptCalls = 0
    let prompt = ""
    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({ error: true }),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async (params) => {
          promptCalls++
          prompt = ((params as { body: { parts: { text: string }[] } }).body.parts[0]?.text ?? "")
          return {}
        },
      },
    })

    startTaskSchedulers(dir)
    try {
      // Let the watcher finish its initial scan, then touch a watched file.
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(path.join(dir, "src", "app.ts"), "v2\n")
      // Past the 5s debounce plus dispatch time.
      await new Promise((resolve) => setTimeout(resolve, 6000))

      expect(readState(dir).tasks["rebuild"]?.has_watch_changed).toBeUndefined() // consumed on dispatch
      expect(readState(dir).tasks["rebuild"]?.matched_watch_globs).toBeUndefined()
      expect(promptCalls).toBe(1)
      expect(prompt).toContain("A watched path matching `src/**` changed.")
      expect(prompt).not.toContain(path.join(dir, "src", "app.ts"))
    } finally {
      stopTaskSchedulers(dir)
    }
  }, 15000)

  test("a watcher catches a directory that appears after startup", async () => {
    // No src/ yet: the watcher starts at the nearest existing parent.
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })

    let promptCalls = 0
    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({ error: true }),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => { promptCalls++; return {} },
      },
    })

    startTaskSchedulers(dir)
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      // The directory appears after startup; no board change/reconcile needed.
      mkdirSync(path.join(dir, "src"), { recursive: true })
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(path.join(dir, "src", "app.ts"), "v1\n")
      await new Promise((resolve) => setTimeout(resolve, 6000))

      expect(promptCalls).toBe(1)
    } finally {
      stopTaskSchedulers(dir)
    }
  }, 15000)

  test("an unwatched change does not trigger the task", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
      "other/notes.txt": "n\n",
    })

    let promptCalls = 0
    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({ error: true }),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => { promptCalls++; return {} },
      },
    })

    startTaskSchedulers(dir)
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(path.join(dir, "other", "notes.txt"), "n2\n")
      await new Promise((resolve) => setTimeout(resolve, 6000))
      expect(readState(dir).tasks["rebuild"]?.has_watch_changed).toBeUndefined()
      expect(promptCalls).toBe(0)
    } finally {
      stopTaskSchedulers(dir)
    }
  }, 15000)

  test("dispatch consumes the trigger, and a later trigger re-runs the task", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
      "src/app.ts": "v1\n",
    })

    let promptCalls = 0
    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        // The second run resumes the recorded session, so `get` must succeed.
        get: async () => ({ data: { id: "ses_1", permission: [] } }),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => { promptCalls++; return {} },
      },
    })

    const waitForCalls = async (n: number) => {
      for (let i = 0; i < 100 && promptCalls < n; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }

    updateTask(dir, "rebuild", { has_watch_changed: true })
    spawnWorker(dir)
    await waitForCalls(1)
    expect(promptCalls).toBe(1)
    // Consumed by the dispatch; the completion write must leave it cleared.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(readState(dir).tasks["rebuild"]?.has_watch_changed).toBeUndefined()

    // A change arriving after that run re-queues the task. `last_run` is aged
    // past the dispatch-grace window so the task counts as free again.
    updateTask(dir, "rebuild", { has_watch_changed: true, last_run: new Date(Date.now() - 60_000).toISOString() })
    spawnWorker(dir)
    await waitForCalls(2)
    expect(promptCalls).toBe(2)
  })

  test("reconcile clears a stale trigger when the watch globs change", () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
      "src/app.ts": "v1\n",
      "docs/notes.md": "n\n",
    })

    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({ error: true }),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => ({}),
      },
    })

    startTaskSchedulers(dir)
    try {
      updateTask(dir, "rebuild", { has_watch_changed: true })
      // The task now watches something else; the old trigger no longer counts.
      writeFileSync(path.join(dir, "docs", "rebuild.md"), "---\nwatch: docs/**\n---\nrebuild\n")
      reconcileTaskSchedulers(dir)
      expect(readState(dir).tasks["rebuild"]?.has_watch_changed).toBeUndefined()
    } finally {
      stopTaskSchedulers(dir)
    }
  })
})

describe("tryRunDueTask", () => {
  function stubClient(dir: string, onPrompt: () => void) {
    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({ data: { id: "ses_1", permission: [] } }),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => { onPrompt(); return {} },
      },
    })
  }

  async function waitForCalls(calls: () => number, n: number) {
    for (let i = 0; i < 100 && calls() < n; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  test("is a no-op while runtime schedulers are disabled", () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    updateTask(dir, "rebuild", { has_watch_changed: true })
    tryRunDueTask(dir)
    expect(taskSchedulersEnabled(dir)).toBe(false)
  })

  test("does not resume a merely-active task", async () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    let promptCalls = 0
    stubClient(dir, () => { promptCalls++ })

    startTaskSchedulers(dir)
    try {
      await waitForCalls(() => promptCalls, 1)
      expect(promptCalls).toBe(1) // the initial start run
      tryRunDueTask(dir)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(promptCalls).toBe(1) // active but not trigger-due: no resume
    } finally {
      stopTaskSchedulers(dir)
    }
  })

  test("spawns a watch-triggered task", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
      "src/app.ts": "v1\n",
    })
    let promptCalls = 0
    stubClient(dir, () => { promptCalls++ })

    startTaskSchedulers(dir)
    try {
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(promptCalls).toBe(0) // no watched change yet
      updateTask(dir, "rebuild", { has_watch_changed: true })
      tryRunDueTask(dir)
      await waitForCalls(() => promptCalls, 1)
      expect(promptCalls).toBe(1)
    } finally {
      stopTaskSchedulers(dir)
    }
  })

  test("spawns a recurring task only when due", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Repeat](docs/repeat.md)\n",
      "docs/repeat.md": "---\nevery: 60\n---\nrepeat\n",
    })
    let promptCalls = 0
    stubClient(dir, () => { promptCalls++ })

    startTaskSchedulers(dir)
    try {
      await waitForCalls(() => promptCalls, 1)
      expect(promptCalls).toBe(1) // never ran: due at start

      tryRunDueTask(dir) // just ran: not due
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(promptCalls).toBe(1)

      // Age the run past the interval and the dispatch grace.
      updateTask(dir, "repeat", { last_run: new Date(Date.now() - 120_000).toISOString() })
      tryRunDueTask(dir)
      await waitForCalls(() => promptCalls, 2)
      expect(promptCalls).toBe(2)
    } finally {
      stopTaskSchedulers(dir)
    }
  })
})

describe("runtime scheduler controls", () => {
  test("starts disabled and toggles with start/stop", () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    expect(taskSchedulersEnabled(dir)).toBe(false)

    startTaskSchedulers(dir)
    expect(taskSchedulersEnabled(dir)).toBe(true)

    stopTaskSchedulers(dir)
    expect(taskSchedulersEnabled(dir)).toBe(false)
  })

  test("tracks runtime client connectivity", () => {
    const dir = setupProject({})
    expect(taskRuntimeConnected(dir)).toBe(false)

    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({}),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => ({}),
      },
    })
    expect(taskRuntimeConnected(dir)).toBe(true)
  })

  test("tryRunTask is a no-op while runtime schedulers are disabled", () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    tryRunTask(dir)
    expect(taskSchedulersEnabled(dir)).toBe(false)
  })

  test("spawnWorker ignores overlapping runs", async () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })

    let releasePrompt: (() => void) | undefined
    const promptDone = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    let promptCalls = 0

    registerTaskRuntimeClient(dir, {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({ error: true }),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => {
          promptCalls++
          await promptDone
          return {}
        },
      },
    })

    spawnWorker(dir)
    spawnWorker(dir)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(promptCalls).toBe(1)

    releasePrompt?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})
