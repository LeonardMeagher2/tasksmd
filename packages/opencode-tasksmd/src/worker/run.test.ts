import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"

import { readState, stateFile, updateTask } from "../state"
import type { PluginClient } from "../types"
import { runTaskBySlug } from "./run"

describe("runTaskBySlug", () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) {
      const dir = dirs.pop()!
      rmSync(stateFile(dir), { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function recurringProject(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-run-"))
    dirs.push(dir)
    writeFileSync(path.join(dir, "TASKS.md"), "- [ ] [Hourly review](checks/hourly.md)\n")
    mkdirSync(path.join(dir, "checks"), { recursive: true })
    writeFileSync(path.join(dir, "checks", "hourly.md"), "---\nevery: 1 hour\n---\nreview\n")
    return dir
  }

  function countingClient(): { client: PluginClient; prompts: () => number } {
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
            return {}
          },
        },
      },
    }
  }

  test("skips a recurring task that is not due yet", async () => {
    const dir = recurringProject()
    updateTask(dir, "hourly-review", { last_run: new Date().toISOString() })

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(0)
  })

  test("runs a recurring task once it is due", async () => {
    const dir = recurringProject()
    updateTask(dir, "hourly-review", { last_run: new Date(Date.now() - 7200_000).toISOString() })

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(1)
  })

  test("runs a recurring task that has never run", async () => {
    const dir = recurringProject()

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(1)
  })

  test("a forced run ignores the recurring due-check", async () => {
    const dir = recurringProject()
    updateTask(dir, "hourly-review", { last_run: new Date().toISOString() })

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client, true)
    expect(prompts()).toBe(1)
  })

  test("a worktree task's session is created in the worktree directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-run-"))
    dirs.push(dir)
    const git = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: dir, encoding: "utf-8" })
      if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
    }
    git(["init", "-b", "main"])
    git(["config", "user.name", "test"])
    git(["config", "user.email", "test@example.com"])
    git(["config", "core.autocrlf", "false"])
    writeFileSync(path.join(dir, "TASKS.md"), "---\nworktree: true\n---\n- [ ] Ship it\n")
    git(["add", "-A"])
    git(["commit", "-m", "init"])

    let createDirectory = ""
    const { client } = countingClient()
    client.session.create = async (input: unknown) => {
      createDirectory = (input as { query?: { directory?: string } }).query?.directory ?? ""
      return { data: { id: "ses_wt" } }
    }

    await runTaskBySlug(dir, "ship-it", client)
    expect(createDirectory).toBe(path.join(dir, ".opencode", "tasks", "worktrees", "ship-it"))

    const run = readState(dir).tasks["ship-it"]
    expect(run?.worktree).toBe(createDirectory)
    expect(run?.branch).toBe("task/ship-it")
  })

  test("does not add trailing blank lines when a missing linked task is blocked", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-run-"))
    dirs.push(dir)
    writeFileSync(path.join(dir, "TASKS.md"), "- [ ] [Missing link](checks/missing.md)\n")

    const { client } = countingClient()
    await expect(runTaskBySlug(dir, "missing-link", client)).rejects.toThrow(
      "Linked task file not found: checks/missing.md",
    )

    const content = readFileSync(path.join(dir, "TASKS.md"), "utf-8")
    expect(content).toBe("- [!] [Missing link](checks/missing.md)\n")
    expect(content.endsWith("\n\n")).toBe(false)
  })
})
