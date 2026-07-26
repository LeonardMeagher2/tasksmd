import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { stateFile, updateTask } from "../state"
import type { PluginClient, SessionStatus } from "../types"
import { findTask } from "./select"

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    rmSync(stateFile(dir), { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempProject(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-select-"))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

function makeClient(statuses: Record<string, SessionStatus> = {}): PluginClient {
  return {
    tui: { showToast: async () => ({}) },
    app: { agents: async () => ({ data: [] }) },
    session: {
      get: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      status: async () => ({ data: statuses }),
      promptAsync: async () => ({}),
    },
  }
}

const client = makeClient()

function ago(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
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

  test("selects a due recurring task above the pending work", async () => {
    const dir = tempProject({ "checks/hourly.md": "---\nevery: 1 hour\n---\nreview\n" })
    const parsed = parseChecklist("- [ ] [Hourly review](checks/hourly.md)\n- [ ] Build the thing\n")
    updateTask(dir, "hourly-review", { last_run: ago(7200) })

    const selected = await findTask(dir, parsed, client)
    expect(selected?.slug).toBe("hourly-review")
  })

  test("skips a recurring task that is not due yet", async () => {
    const dir = tempProject({ "checks/hourly.md": "---\nevery: 1 hour\n---\nreview\n" })
    const parsed = parseChecklist("- [ ] [Hourly review](checks/hourly.md)\n- [ ] Build the thing\n")
    updateTask(dir, "hourly-review", { last_run: ago(60) })

    const selected = await findTask(dir, parsed, client)
    expect(selected?.slug).toBe("build-the-thing")
  })

  test("runs a recurring task with no recorded run", async () => {
    const dir = tempProject({ "checks/hourly.md": "---\nevery: 1 hour\n---\nreview\n" })
    const parsed = parseChecklist("- [ ] [Hourly review](checks/hourly.md)\n- [ ] Build the thing\n")

    const selected = await findTask(dir, parsed, client)
    expect(selected?.slug).toBe("hourly-review")
  })

  test("reruns a due recurring task that is already done", async () => {
    const dir = tempProject({ "checks/hourly.md": "---\nevery: 1 hour\n---\nreview\n" })
    const parsed = parseChecklist("- [x] [Hourly review](checks/hourly.md)\n- [ ] Build the thing\n")
    updateTask(dir, "hourly-review", { last_run: ago(7200) })

    const selected = await findTask(dir, parsed, client)
    expect(selected?.slug).toBe("hourly-review")
  })

  test("passes over a due recurring task whose session is still working", async () => {
    const dir = tempProject({ "checks/hourly.md": "---\nevery: 1 hour\n---\nreview\n" })
    const parsed = parseChecklist("---\nmax_active: 2\n---\n- [~] [Hourly review](checks/hourly.md)\n- [ ] Build the thing\n")
    updateTask(dir, "hourly-review", { last_run: ago(7200), session_id: "ses_busy" })

    const busy = makeClient({ ses_busy: { type: "running" } })
    const selected = await findTask(dir, parsed, busy)
    expect(selected?.slug).toBe("build-the-thing")
  })

  test("takes the board in order, not by state", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("- [ ] First\n- [~] Second\n")

    const selected = await findTask(dir, parsed, client)
    expect(selected?.slug).toBe("first")
  })

  test("resumes an active task whose session went idle", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("- [~] First\n- [ ] Second\n")
    updateTask(dir, "first", { session_id: "ses_idle" })

    const idle = makeClient({ ses_idle: { type: "idle" } })
    const selected = await findTask(dir, parsed, idle)
    expect(selected?.slug).toBe("first")
  })

  test("an active task with an idle session does not hold a max_active slot", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("- [~] First\n- [ ] Second\n")
    updateTask(dir, "first", { session_id: "ses_busy" })

    const busy = makeClient({ ses_busy: { type: "running" } })
    expect((await findTask(dir, parsed, busy))?.slug).toBeUndefined()
    expect((await findTask(dir, parsed, makeClient()))?.slug).toBe("first")
  })

  test("a working recurring session takes up a max_active slot", async () => {
    const dir = tempProject({ "checks/hourly.md": "---\nevery: 1 hour\n---\nreview\n" })
    const parsed = parseChecklist("- [~] [Hourly review](checks/hourly.md)\n- [ ] Build the thing\n")
    updateTask(dir, "hourly-review", { last_run: ago(60), session_id: "ses_busy" })

    const busy = makeClient({ ses_busy: { type: "running" } })
    const selected = await findTask(dir, parsed, busy)
    expect(selected).toBeUndefined()
  })

  test("a working session counts even while the board still reads pending", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("- [ ] First\n- [ ] Second\n")
    updateTask(dir, "first", { session_id: "ses_busy" })

    const busy = makeClient({ ses_busy: { type: "running" } })
    const selected = await findTask(dir, parsed, busy)
    expect(selected).toBeUndefined()
  })

  test("a due recurring task waits while every slot is working", async () => {
    const dir = tempProject({ "checks/hourly.md": "---\nevery: 1 hour\n---\nreview\n" })
    const parsed = parseChecklist("- [ ] [Hourly review](checks/hourly.md)\n- [~] Build the thing\n")
    updateTask(dir, "build-the-thing", { session_id: "ses_busy" })

    const busy = makeClient({ ses_busy: { type: "running" } })
    expect(await findTask(dir, parsed, busy)).toBeUndefined()
    expect((await findTask(dir, parsed, makeClient()))?.slug).toBe("hourly-review")
  })

  test("a task holds its slot while the runtime catches up with the dispatch", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("- [~] First\n- [ ] Second\n")
    updateTask(dir, "first", { session_id: "ses_new", last_run: new Date().toISOString() })

    // The session was prompted a moment ago and is not reported busy yet.
    const selected = await findTask(dir, parsed, makeClient())
    expect(selected).toBeUndefined()
  })

  test("a slot is released once the grace window passes and nothing is working", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("- [~] First\n- [ ] Second\n")
    updateTask(dir, "first", { session_id: "ses_idle", last_run: ago(60) })

    const selected = await findTask(dir, parsed, makeClient({ ses_idle: { type: "idle" } }))
    expect(selected?.slug).toBe("first")
  })

  test("max_active false runs alongside working sessions", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("---\nmax_active: false\n---\n- [ ] First\n- [ ] Second\n")
    updateTask(dir, "first", { session_id: "ses_busy" })

    const busy = makeClient({ ses_busy: { type: "running" } })
    const selected = await findTask(dir, parsed, busy)
    expect(selected?.slug).toBe("second")
  })

  test("a bad max_active does not remove the cap", async () => {
    const dir = tempProject()
    const parsed = parseChecklist("---\nmax_active: plenty\n---\n- [ ] First\n- [ ] Second\n")
    updateTask(dir, "first", { session_id: "ses_busy" })

    const busy = makeClient({ ses_busy: { type: "running" } })
    expect(await findTask(dir, parsed, busy)).toBeUndefined()
  })
})
