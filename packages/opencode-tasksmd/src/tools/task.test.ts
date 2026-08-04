import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"
import { addTaskSession, readState, stateFile, updateTask } from "../state"
import { ensureWorktree } from "../worktree"
import { createTaskTools, linkedTaskInfo, taskInfoText } from "./task"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(stateFile(dir), { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
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

describe("task_done", () => {
  test("marks done when reason is empty", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-task-tool-"))
    dirs.push(dir)
    writeFileSync(path.join(dir, "TASKS.md"), "- [ ] Ship it\n")
    addTaskSession(dir, "ship-it", "session-1")

    const tools = createTaskTools(dir)
    const result = await tools.task_done.execute({}, { sessionID: "session-1" } as any)
    const task = parseChecklist(readFileSync(path.join(dir, "TASKS.md"), "utf-8")).tasks[0]

    expect(result).toBe('Task "ship-it" marked done.')
    expect(task?.state).toBe("done")
  })

  test("marks blocked when blocked_reason is provided, and keeps the reason in state", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-task-tool-"))
    dirs.push(dir)
    writeFileSync(path.join(dir, "TASKS.md"), "- [ ] Ship it\n")
    addTaskSession(dir, "ship-it", "session-1")

    const tools = createTaskTools(dir)
    const result = await tools.task_done.execute({ blocked_reason: "Waiting on API key" }, { sessionID: "session-1" } as any)
    const task = parseChecklist(readFileSync(path.join(dir, "TASKS.md"), "utf-8")).tasks[0]

    expect(result).toBe('Task "ship-it" marked blocked: Waiting on API key')
    expect(task?.state).toBe("blocked")
    expect(readState(dir).tasks["ship-it"]?.blocked_reason).toBe("Waiting on API key")
  })

  test("marking done clears a stored blocked reason", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-task-tool-"))
    dirs.push(dir)
    writeFileSync(path.join(dir, "TASKS.md"), "- [!] Ship it\n")
    addTaskSession(dir, "ship-it", "session-1")
    updateTask(dir, "ship-it", { blocked_reason: "Waiting on API key" })

    const tools = createTaskTools(dir)
    const result = await tools.task_done.execute({}, { sessionID: "session-1" } as any)

    expect(result).toBe('Task "ship-it" marked done.')
    expect(readState(dir).tasks["ship-it"]?.blocked_reason).toBeUndefined()
  })
})

describe("task_done with a worktree", () => {
  function git(cwd: string, args: string[]): void {
    const result = spawnSync("git", args, { cwd, encoding: "utf-8" })
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }

  function initBoard(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-task-tool-"))
    dirs.push(dir)
    git(dir, ["init", "-b", "main"])
    git(dir, ["config", "user.name", "test"])
    git(dir, ["config", "user.email", "test@example.com"])
    git(dir, ["config", "core.autocrlf", "false"])
    writeFileSync(path.join(dir, "TASKS.md"), "---\nworktree: true\n---\n- [~] Ship it\n")
    writeFileSync(path.join(dir, "file.txt"), "base\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-m", "init"])
    return dir
  }

  function seedWorktreeRun(dir: string) {
    const info = ensureWorktree(dir, "ship-it")!
    writeFileSync(path.join(info.path, "file.txt"), "from worktree\n")
    addTaskSession(dir, "ship-it", "session-1")
    updateTask(dir, "ship-it", { worktree: info.path, branch: info.branch, base: info.base })
    return info
  }

  test("auto_merge commits, merges, cleans up, and marks done", async () => {
    const dir = initBoard()
    const info = seedWorktreeRun(dir)

    const tools = createTaskTools(dir)
    const result = await tools.task_done.execute({}, { sessionID: "session-1" } as any)

    expect(result).toBe('Task "ship-it" marked done and merged task/ship-it.')
    const task = parseChecklist(readFileSync(path.join(dir, "TASKS.md"), "utf-8")).tasks[0]
    expect(task?.state).toBe("done")
    expect(readFileSync(path.join(dir, "file.txt"), "utf-8")).toBe("from worktree\n")
    expect(existsSync(info.path)).toBe(false)

    const run = readState(dir).tasks["ship-it"]
    expect(run?.worktree).toBeUndefined()
    expect(run?.branch).toBeUndefined()
  })

  test("a merge conflict blocks the task and keeps the branch", async () => {
    const dir = initBoard()
    const info = seedWorktreeRun(dir)

    writeFileSync(path.join(dir, "file.txt"), "from main\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-m", "main moves"])

    const tools = createTaskTools(dir)
    const result = await tools.task_done.execute({}, { sessionID: "session-1" } as any)

    expect(result).toContain('Task "ship-it" was marked blocked: auto-merge could not merge task/ship-it cleanly')
    const task = parseChecklist(readFileSync(path.join(dir, "TASKS.md"), "utf-8")).tasks[0]
    expect(task?.state).toBe("blocked")
    expect(readState(dir).tasks["ship-it"]?.blocked_reason).toContain("auto-merge")
    expect(existsSync(info.path)).toBe(true)
  })
})
