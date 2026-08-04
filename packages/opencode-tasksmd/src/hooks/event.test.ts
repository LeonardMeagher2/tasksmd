import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"

import { addTaskSession, readState, stateFile, updateTask } from "../state"
import type { PluginClient } from "../types"
import { ensureWorktree } from "../worktree"
import { checkPanic } from "./event"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(stateFile(dir), { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
}

/** A git repo whose board has worktrees on and one active task. */
function initProject(board = "---\nworktree: true\n---\n- [~] Ship it\n"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-event-"))
  dirs.push(dir)
  git(dir, ["init", "-b", "main"])
  git(dir, ["config", "user.name", "test"])
  git(dir, ["config", "user.email", "test@example.com"])
  git(dir, ["config", "core.autocrlf", "false"])
  writeFileSync(path.join(dir, "TASKS.md"), board)
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-m", "init"])
  return dir
}

function seedRun(dir: string): { path: string; branch: string; base: string } {
  const info = ensureWorktree(dir, "ship-it")!
  addTaskSession(dir, "ship-it", "ses_1")
  updateTask(dir, "ship-it", { worktree: info.path, branch: info.branch, base: info.base })
  return info
}

function recordingClient(): { client: PluginClient; deleted: Array<{ id: string; directory: string }> } {
  const deleted: Array<{ id: string; directory: string }> = []
  const client = {
    tui: { showToast: async () => ({}) },
    app: { agents: async () => ({ data: [] }) },
    session: {
      get: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      status: async () => ({ data: {} }),
      promptAsync: async () => ({}),
      delete: async (params: unknown) => {
        const p = params as { path?: { id?: string }; query?: { directory?: string } }
        deleted.push({ id: p.path?.id ?? "", directory: p.query?.directory ?? "" })
        return {}
      },
    },
  } as PluginClient
  return { client, deleted }
}

describe("checkPanic", () => {
  test("an idle session with no changes increments empty_attempts", async () => {
    const dir = initProject()
    seedRun(dir)
    const { client, deleted } = recordingClient()

    await checkPanic(client, dir, "ses_1", 0)

    expect(readState(dir).tasks["ship-it"]?.empty_attempts).toBe(1)
    expect(deleted).toHaveLength(0)
  })

  test("changes in the worktree reset the count instead", async () => {
    const dir = initProject()
    const info = seedRun(dir)
    updateTask(dir, "ship-it", { empty_attempts: 2 })
    writeFileSync(path.join(info.path, "progress.txt"), "work\n")
    const { client, deleted } = recordingClient()

    await checkPanic(client, dir, "ses_1", 0)

    expect(readState(dir).tasks["ship-it"]?.empty_attempts).toBeUndefined()
    expect(deleted).toHaveLength(0)
  })

  test("at the limit the session is deleted and the board is untouched", async () => {
    const dir = initProject()
    const info = seedRun(dir)
    updateTask(dir, "ship-it", { empty_attempts: 2 })
    const { client, deleted } = recordingClient()

    await checkPanic(client, dir, "ses_1", 0)

    expect(deleted).toEqual([{ id: "ses_1", directory: info.path }])
    const run = readState(dir).tasks["ship-it"]
    expect(run?.session_id).toBeUndefined()
    expect(run?.empty_attempts).toBeUndefined()
    expect(readState(dir).tasks["ship-it"]?.worktree).toBe(info.path)
    // The board still reads active — the next check starts the task fresh.
    expect(readFileSync(path.join(dir, "TASKS.md"), "utf-8")).toContain("- [~] Ship it")
  })

  test("no panic when attempts is disabled in config", async () => {
    const dir = initProject("---\nworktree:\n  attempts: false\n---\n- [~] Ship it\n")
    seedRun(dir)
    updateTask(dir, "ship-it", { empty_attempts: 2 })
    const { client, deleted } = recordingClient()

    await checkPanic(client, dir, "ses_1", 0)

    expect(deleted).toHaveLength(0)
    expect(readState(dir).tasks["ship-it"]?.empty_attempts).toBe(2)
  })

  test("a session with no task or no worktree is ignored", async () => {
    const dir = initProject()
    const { client, deleted } = recordingClient()

    await checkPanic(client, dir, "ses_unknown", 0)
    expect(deleted).toHaveLength(0)
  })
})
