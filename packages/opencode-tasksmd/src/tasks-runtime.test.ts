import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  configuredSchedulers,
  registerTaskRuntimeClient,
  spawnWorker,
  startTaskSchedulers,
  stopTaskSchedulers,
  taskRuntimeConnected,
  taskSchedulersEnabled,
  tryRunTask,
} from "./tasks-runtime"

const projectDirs: string[] = []

afterEach(() => {
  while (projectDirs.length) {
    const dir = projectDirs.pop()!
    stopTaskSchedulers(dir)
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
