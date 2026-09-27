import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { anyTriggerDue, scheduleDue } from "./schedule"
import type { ProjectState } from "./state"

const NOW = Date.parse("2026-01-01T12:00:00.000Z")

function at(minutesAgo: number): string {
  return new Date(NOW - minutesAgo * 60_000).toISOString()
}

describe("scheduleDue", () => {
  test("a task that never ran is due", () => {
    expect(scheduleDue(undefined, 3600, NOW)).toBe(true)
  })

  test("an unreadable timestamp is treated as never run", () => {
    expect(scheduleDue("soon", 3600, NOW)).toBe(true)
  })

  test("not due before the interval has passed", () => {
    expect(scheduleDue(at(59), 3600, NOW)).toBe(false)
  })

  test("due once the interval has passed", () => {
    expect(scheduleDue(at(60), 3600, NOW)).toBe(true)
  })

  test("a missed interval is still due, not skipped", () => {
    expect(scheduleDue(at(600), 3600, NOW)).toBe(true)
  })

  test("no interval is never due", () => {
    expect(scheduleDue(undefined, 0, NOW)).toBe(false)
  })
})

describe("anyTriggerDue", () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  function setup(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-due-"))
    dirs.push(dir)
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel)
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    return dir
  }

  const empty: ProjectState = { tasks: {} }

  test("false when no task declares a trigger", () => {
    const dir = setup({ "TASKS.md": "- [ ] Do work\n" })
    expect(anyTriggerDue(dir, parseChecklist("- [ ] Do work\n"), empty)).toBe(false)
  })

  test("a merely active task is not due", () => {
    const dir = setup({ "TASKS.md": "- [~] Do work\n" })
    expect(anyTriggerDue(dir, parseChecklist("- [~] Do work\n"), empty)).toBe(false)
  })

  test("true when a watched task is triggered", () => {
    const dir = setup({
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [~] [Rebuild](docs/rebuild.md)\n")
    const state: ProjectState = { tasks: { rebuild: { triggered: true } } }
    expect(anyTriggerDue(dir, parsed, state)).toBe(true)
  })

  test("false when a watched task is not triggered", () => {
    const dir = setup({
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [ ] [Rebuild](docs/rebuild.md)\n")
    expect(anyTriggerDue(dir, parsed, empty)).toBe(false)
  })

  test("true when a recurring task is due, false when it is not", () => {
    const dir = setup({
      "docs/repeat.md": "---\nevery: 3600\n---\nrepeat\n",
    })
    const parsed = parseChecklist("- [~] [Repeat](docs/repeat.md)\n")
    expect(anyTriggerDue(dir, parsed, empty, NOW)).toBe(true)
    const recent: ProjectState = { tasks: { repeat: { last_run: at(30) } } }
    expect(anyTriggerDue(dir, parsed, recent, NOW)).toBe(false)
  })

  test("a task with every and watch requires both triggers", () => {
    const dir = setup({
      "docs/rebuild.md": "---\nevery: 3600\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [~] [Rebuild](docs/rebuild.md)\n")
    const intervalDue: ProjectState = { tasks: { rebuild: { last_run: at(60) } } }
    const watchDue: ProjectState = { tasks: { rebuild: { last_run: at(30), triggered: true } } }
    const bothDue: ProjectState = { tasks: { rebuild: { last_run: at(60), triggered: true } } }

    expect(anyTriggerDue(dir, parsed, intervalDue, NOW)).toBe(false)
    expect(anyTriggerDue(dir, parsed, watchDue, NOW)).toBe(false)
    expect(anyTriggerDue(dir, parsed, bothDue, NOW)).toBe(true)
  })

  test("a blocked task does not count as due", () => {
    const dir = setup({
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [!] [Rebuild](docs/rebuild.md)\n")
    const state: ProjectState = { tasks: { rebuild: { triggered: true } } }
    expect(anyTriggerDue(dir, parsed, state)).toBe(false)
  })
})
