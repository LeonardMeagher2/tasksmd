import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { openBoard, taskContext } from "./context"

const BOARD = `---
every: 5 minutes
max_active: 2
permission:
  bash: deny
---

- [ ] First task
- [~] Second task
  - [ ] Sub task
`

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-context-"))
  writeFileSync(path.join(dir, "TASKS.md"), BOARD, "utf-8")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("taskContext", () => {
  test("resolves a directory to its TASKS.md", () => {
    expect(taskContext(dir, "first-task").boardPath).toBe(path.join(dir, "TASKS.md"))
  })

  test("accepts a direct file path", () => {
    const file = path.join(dir, "TASKS.md")
    expect(taskContext(file, "first-task").boardPath).toBe(file)
  })

  test("state reflects the board", () => {
    expect(taskContext(dir, "first-task").state()).toBe("pending")
    expect(taskContext(dir, "second-task").state()).toBe("active")
    expect(taskContext(dir, "missing").state()).toBeUndefined()
  })

  test("current returns the parsed task, including subtasks", () => {
    expect(taskContext(dir, "first-task").current()?.text).toBe("First task")
    expect(taskContext(dir, "sub-task").current()?.text).toBe("Sub task")
  })

  test("markDone updates the marker on disk", () => {
    expect(taskContext(dir, "first-task").markDone()).toBe(true)
    const content = readFileSync(path.join(dir, "TASKS.md"), "utf-8")
    expect(content).toContain("- [x] First task")
    expect(taskContext(dir, "first-task").state()).toBe("done")
  })

  test("markBlocked and markPending round-trip", () => {
    const ctx = taskContext(dir, "second-task")
    expect(ctx.markBlocked()).toBe(true)
    expect(ctx.state()).toBe("blocked")
    expect(ctx.markPending()).toBe(true)
    expect(ctx.state()).toBe("pending")
  })

  test("mutations preserve frontmatter and other tasks", () => {
    taskContext(dir, "first-task").markDone()
    const content = readFileSync(path.join(dir, "TASKS.md"), "utf-8")
    expect(content).toContain("max_active: 2")
    expect(content).toContain("- [~] Second task")
    expect(content).toContain("  - [ ] Sub task")
  })

  test("setState returns false for an unknown slug", () => {
    expect(taskContext(dir, "missing").setState("done")).toBe(false)
  })

  test("ops return false when the board does not exist", () => {
    const ctx = taskContext(path.join(dir, "nowhere"), "first-task")
    expect(ctx.markDone()).toBe(false)
    expect(ctx.state()).toBeUndefined()
  })

  test("config is the board frontmatter", () => {
    expect(taskContext(dir, "first-task").config()).toEqual({
      every: "5 minutes",
      max_active: 2,
      permission: { bash: "deny" },
    })
  })

  test("config merges the linked task file's frontmatter", () => {
    writeFileSync(path.join(dir, "TASKS.md"), "---\nmodel: ollama/base\n---\n\n- [ ] [Linked](task.md)\n", "utf-8")
    writeFileSync(path.join(dir, "task.md"), "---\nmodel: ollama/override\n---\n\nDo the thing.\n", "utf-8")
    expect(taskContext(dir, "linked").config()).toEqual({ model: "ollama/override" })
  })

  test("config falls back to board frontmatter when the linked file is missing", () => {
    writeFileSync(path.join(dir, "TASKS.md"), "---\nmodel: ollama/base\n---\n\n- [ ] [Linked](gone.md)\n", "utf-8")
    expect(taskContext(dir, "linked").config()).toEqual({ model: "ollama/base" })
  })
})

describe("openBoard", () => {
  test("exists reflects the file", () => {
    expect(openBoard(dir).exists()).toBe(true)
    expect(openBoard(path.join(dir, "nowhere")).exists()).toBe(false)
  })

  test("tasks returns top-level tasks only", () => {
    expect(openBoard(dir).tasks().map((t) => t.slug)).toEqual(["first-task", "second-task"])
  })

  test("config returns the board frontmatter", () => {
    expect(openBoard(dir).config()).toMatchObject({ max_active: 2 })
  })

  test("task returns a working context", () => {
    expect(openBoard(dir).task("first-task").markDone()).toBe(true)
    expect(openBoard(dir).task("first-task").state()).toBe("done")
  })

  test("missing board yields empty views instead of throwing", () => {
    const board = openBoard(path.join(dir, "nowhere"))
    expect(board.tasks()).toEqual([])
    expect(board.config()).toEqual({})
  })
})
