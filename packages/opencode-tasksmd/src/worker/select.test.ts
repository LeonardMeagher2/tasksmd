import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import type { PluginClient } from "../types"
import { findTask } from "./select"

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-select-"))
  dirs.push(dir)
  return dir
}

const client: PluginClient = {
  tui: { showToast: async () => ({}) },
  app: { agents: async () => ({ data: [] }) },
  session: {
    get: async () => ({}),
    create: async () => ({}),
    update: async () => ({}),
    status: async () => ({ data: {} }),
    promptAsync: async () => ({}),
  },
}

describe("findTask", () => {
  test("does not select done task when board has recurring schedule", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("---\nevery: 1 minute\n---\n- [x] Say hello\n")
    const selected = await findTask(dir, parsed, client)
    expect(selected).toBeUndefined()
  })

  test("does not select done task without board schedule", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("- [x] Say hello\n")
    const selected = await findTask(dir, parsed, client)
    expect(selected).toBeUndefined()
  })
})
