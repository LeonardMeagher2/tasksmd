import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { linkedTaskInfo, taskInfoText } from "./task"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function linkedTask(overrides: Partial<ChecklistTask> = {}): ChecklistTask {
  return {
    slug: "ship-it",
    indent: 0,
    state: "pending",
    text: "Ship it",
    raw: "- [ ] [Ship it](docs/task.md)",
    body: "",
    subtasks: [],
    link: { text: "Ship it", path: "docs/task.md" },
    line: 6,
    ...overrides,
  }
}

describe("taskInfoText", () => {
  test("includes TASKS.md location with 1-based line number", () => {
    const info = taskInfoText("ship-it", "/tmp/project/TASKS.md", linkedTask())
    expect(info).toContain("Task location: TASKS.md:7")
  })

  test("includes linked task context chunk", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-task-tool-"))
    dirs.push(dir)
    mkdirSync(path.join(dir, "docs"), { recursive: true })
    writeFileSync(path.join(dir, "docs", "task.md"), "# Goal\nShip it")

    const info = taskInfoText("ship-it", path.join(dir, "TASKS.md"), linkedTask())
    expect(info).toContain("Linked task context:")
    expect(info).toContain("Linked task file: docs/task.md")
    expect(info).toContain("# Goal")
  })
})

describe("linkedTaskInfo", () => {
  test("shows a missing linked file message", () => {
    const info = linkedTaskInfo("/tmp/project/TASKS.md", linkedTask())
    expect(info).toBe("Linked task file: docs/task.md (missing)")
  })

  test("shows unreadable when linked path is not a file", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-task-tool-"))
    dirs.push(dir)
    mkdirSync(path.join(dir, "docs"), { recursive: true })

    const info = linkedTaskInfo(
      path.join(dir, "TASKS.md"),
      linkedTask({
        raw: "- [ ] [Ship it](docs)",
        link: { text: "Ship it", path: "docs" },
      }),
    )
    expect(info).toBe("Linked task file: docs (unreadable)")
  })
})
