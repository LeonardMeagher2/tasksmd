import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { logFile, stateFile } from "../state"
import { registerTaskRuntimeClient, stopTaskSchedulers } from "../tasks-runtime"
import type { PluginClient } from "../types"
import { createWorkerTools } from "./worker"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    stopTaskSchedulers(dir)
    rmSync(stateFile(dir), { force: true })
    rmSync(logFile(dir), { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-worker-tools-"))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

function countingClient(gate?: Promise<void>): { client: PluginClient; prompts: () => number } {
  let prompts = 0
  return {
    prompts: () => prompts,
    client: {
      tui: { showToast: async () => ({}) },
      app: { agents: async () => ({ data: [] }) },
      session: {
        get: async () => ({}),
        create: async () => ({ data: { id: "ses_1" } }),
        update: async () => ({}),
        status: async () => ({ data: {} }),
        promptAsync: async () => {
          prompts++
          if (gate) await gate
          return {}
        },
      },
    },
  }
}

describe("tasks_run", () => {
  test("reports a missing board", async () => {
    const dir = project()
    const tools = createWorkerTools(dir)
    const result = await tools.tasks_run.execute({ slug: "ship-it" }, {} as any)
    expect(result).toBe("No TASKS.md in this project.")
  })

  test("reports an unknown slug", async () => {
    const dir = project({ "TASKS.md": "- [ ] Ship it\n" })
    const tools = createWorkerTools(dir)
    const result = await tools.tasks_run.execute({ slug: "nope" }, {} as any)
    expect(result).toBe('No task "nope" on the board.')
  })

  test("refuses a blocked task", async () => {
    const dir = project({ "TASKS.md": "- [!] Ship it\n" })
    const tools = createWorkerTools(dir)
    const result = await tools.tasks_run.execute({ slug: "ship-it" }, {} as any)
    expect(result).toBe('Task "ship-it" is blocked. Unblock it on the board first.')
  })

  test("dispatches a waiting task with schedulers off", async () => {
    const dir = project({ "TASKS.md": "- [ ] Ship it\n" })
    const { client, prompts } = countingClient()
    registerTaskRuntimeClient(dir, client)

    const tools = createWorkerTools(dir)
    const result = await tools.tasks_run.execute({ slug: "ship-it" }, {} as any)

    expect(result).toBe('Task "ship-it" dispatched.')
    expect(prompts()).toBe(1)
  })

  test("declines while another run is in flight", async () => {
    const dir = project({ "TASKS.md": "- [ ] Ship it\n" })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { client, prompts } = countingClient(gate)
    registerTaskRuntimeClient(dir, client)

    const tools = createWorkerTools(dir)
    const first = tools.tasks_run.execute({ slug: "ship-it" }, {} as any)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const second = await tools.tasks_run.execute({ slug: "ship-it" }, {} as any)
    expect(second).toBe("A task run is already in progress. Try again shortly.")

    release?.()
    await first
    expect(prompts()).toBe(1)
  })
})
