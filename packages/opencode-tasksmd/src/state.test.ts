import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { readState, stateFile, logFile, writeState } from "./state"

describe("stateFile", () => {
  test("returns deterministic path for same directory", () => {
    const a = stateFile("/home/user/project")
    const b = stateFile("/home/user/project")
    expect(a).toBe(b)
  })

  test("returns different paths for different directories", () => {
    const a = stateFile("/home/user/project-a")
    const b = stateFile("/home/user/project-b")
    expect(a).not.toBe(b)
  })

  test("is one file named after the project", () => {
    expect(path.basename(stateFile("/home/user/spyro-web"))).toBe("spyro-web.json")
  })

  test("normalises a name that is not path-friendly", () => {
    expect(path.basename(stateFile("/home/user/Spyro Web!"))).toBe("spyro-web.json")
  })

  test("path contains opencode-tasks segment", () => {
    const result = stateFile("/tmp/test-path")
    expect(result).toContain("opencode-tasks")
  })

  test("uses LOCALAPPDATA on win32", () => {
    if (process.platform !== "win32") return
    const original = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local"
    try {
      const result = stateFile("C:\\project")
      expect(result).toBe("C:\\Users\\test\\AppData\\Local\\opencode-tasksmd\\project.json")
    } finally {
      process.env.LOCALAPPDATA = original
    }
  })
})

describe("legacy state", () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) {
      const dir = dirs.pop()!
      rmSync(stateFile(dir), { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function seedLegacyFolder(dir: string, folder: string): string {
    const legacy = path.join(path.dirname(stateFile(dir)), folder)
    mkdirSync(legacy, { recursive: true })
    writeFileSync(path.join(legacy, "state.json"), JSON.stringify({ tasks: { review: { last_run: "2026-01-01T00:00:00.000Z" } } }))
    return legacy
  }

  function tempProject(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-state-"))
    dirs.push(dir)
    return dir
  }

  test("adopts state from the old hash-named folder", () => {
    const dir = tempProject()
    const hash = createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 16)
    const legacy = seedLegacyFolder(dir, hash)

    try {
      expect(readState(dir).tasks.review?.last_run).toBe("2026-01-01T00:00:00.000Z")
      expect(existsSync(legacy)).toBe(false)
    } finally {
      rmSync(legacy, { recursive: true, force: true })
    }
  })

  test("adopts state from the old project-named folder", () => {
    const dir = tempProject()
    const legacy = seedLegacyFolder(dir, path.basename(stateFile(dir), ".json"))

    try {
      expect(readState(dir).tasks.review?.last_run).toBe("2026-01-01T00:00:00.000Z")
      expect(existsSync(legacy)).toBe(false)
    } finally {
      rmSync(legacy, { recursive: true, force: true })
    }
  })
})

describe("logFile", () => {
  test("is one file named after the project", () => {
    expect(path.basename(logFile("/tmp/project"))).toBe("project.log")
  })

  test("path contains opencode-tasks segment", () => {
    const result = logFile("/tmp/project")
    expect(result).toContain("opencode-tasks")
  })
})

describe("state round-trip", () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) {
      const dir = dirs.pop()!
      rmSync(stateFile(dir), { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("worktree and panic fields survive a write and read", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-state-"))
    dirs.push(dir)
    writeState(dir, {
      tasks: {
        "ship-it": {
          session_id: "ses_1",
          blocked_reason: "waiting",
          worktree: path.join(dir, ".opencode", "tasks", "worktrees", "ship-it"),
          branch: "task/ship-it",
          base: "main",
          empty_attempts: 2,
        },
      },
    })

    expect(readState(dir).tasks["ship-it"]).toMatchObject({
      session_id: "ses_1",
      blocked_reason: "waiting",
      branch: "task/ship-it",
      base: "main",
      empty_attempts: 2,
    })
    expect(readState(dir).tasks["ship-it"]?.worktree).toContain("ship-it")
  })

  test("unknown fields are dropped", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-state-"))
    dirs.push(dir)
    mkdirSync(path.dirname(stateFile(dir)), { recursive: true })
    writeFileSync(stateFile(dir), JSON.stringify({ tasks: { a: { worktree: 5, empty_attempts: "x", mystery: true } } }))

    const run = readState(dir).tasks.a
    expect(run?.worktree).toBeUndefined()
    expect(run?.empty_attempts).toBeUndefined()
    expect((run as Record<string, unknown> | undefined)?.mystery).toBeUndefined()
  })
})
