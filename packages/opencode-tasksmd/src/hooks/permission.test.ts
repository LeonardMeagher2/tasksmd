import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createPermissionHook, slugForSession, taskAutoApprove } from "./permission"
import { stateDir, writeState } from "../state"

const projectDirs: string[] = []

afterEach(() => {
  while (projectDirs.length) {
    const dir = projectDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
    rmSync(stateDir(dir), { recursive: true, force: true })
  }
})

function setupProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-perm-"))
  projectDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe("slugForSession", () => {
  test("matches a recorded session", () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    writeState(dir, { schedulers: {}, tasks: { "do-work": { session: "ses_123" } } })
    expect(slugForSession(dir, "ses_123")).toBe("do-work")
  })

  test("returns undefined for an unknown session", () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    writeState(dir, { schedulers: {}, tasks: { "do-work": { session: "ses_123" } } })
    expect(slugForSession(dir, "ses_unknown")).toBeUndefined()
  })

  test("returns undefined for an empty sessionID", () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    writeState(dir, { schedulers: {}, tasks: { "do-work": { session: "ses_123" } } })
    expect(slugForSession(dir, "")).toBeUndefined()
  })
})

describe("taskAutoApprove", () => {
  test("true from board frontmatter", () => {
    const dir = setupProject({ "TASKS.md": "---\nauto_approve: true\n---\n- [ ] Do work\n" })
    expect(taskAutoApprove(dir, "do-work")).toBe(true)
  })

  test("false when unset", () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    expect(taskAutoApprove(dir, "do-work")).toBe(false)
  })

  test("linked file overrides board", () => {
    const dir = setupProject({
      "TASKS.md": "---\nauto_approve: false\n---\n- [ ] [Do the thing](docs/thing.md)\n",
      "docs/thing.md": "---\nauto_approve: true\n---\nDetails here\n",
    })
    expect(taskAutoApprove(dir, "do-the-thing")).toBe(true)
  })

  test("false when task slug not found", () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    expect(taskAutoApprove(dir, "missing-task")).toBe(false)
  })

  test("false when board file is missing", () => {
    const dir = setupProject({})
    expect(taskAutoApprove(dir, "do-work")).toBe(false)
  })
})

describe("createPermissionHook", () => {
  test("sets allow for a task session with auto_approve", async () => {
    const dir = setupProject({ "TASKS.md": "---\nauto_approve: true\n---\n- [ ] Do work\n" })
    writeState(dir, { schedulers: {}, tasks: { "do-work": { session: "ses_123" } } })
    const hook = createPermissionHook(dir)
    const output = { status: "ask" as "ask" | "deny" | "allow" }
    await hook["permission.ask"]!({ sessionID: "ses_123" } as any, output)
    expect(output.status).toBe("allow")
  })

  test("leaves ask for a task without auto_approve", async () => {
    const dir = setupProject({ "TASKS.md": "- [ ] Do work\n" })
    writeState(dir, { schedulers: {}, tasks: { "do-work": { session: "ses_123" } } })
    const hook = createPermissionHook(dir)
    const output = { status: "ask" as "ask" | "deny" | "allow" }
    await hook["permission.ask"]!({ sessionID: "ses_123" } as any, output)
    expect(output.status).toBe("ask")
  })

  test("leaves ask for an unknown (user) session", async () => {
    const dir = setupProject({ "TASKS.md": "---\nauto_approve: true\n---\n- [ ] Do work\n" })
    writeState(dir, { schedulers: {}, tasks: {} })
    const hook = createPermissionHook(dir)
    const output = { status: "ask" as "ask" | "deny" | "allow" }
    await hook["permission.ask"]!({ sessionID: "ses_user" } as any, output)
    expect(output.status).toBe("ask")
  })

  test("does not override a deny status", async () => {
    const dir = setupProject({ "TASKS.md": "---\nauto_approve: true\n---\n- [ ] Do work\n" })
    writeState(dir, { schedulers: {}, tasks: { "do-work": { session: "ses_123" } } })
    const hook = createPermissionHook(dir)
    const output = { status: "deny" as "ask" | "deny" | "allow" }
    await hook["permission.ask"]!({ sessionID: "ses_123" } as any, output)
    expect(output.status).toBe("deny")
  })
})
