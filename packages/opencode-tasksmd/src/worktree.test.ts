import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"

import { resolveProjectRoot } from "./worker/common"
import {
  commitsAhead,
  commitAll,
  ensureWorktree,
  hasChanges,
  isGitRepo,
  mergeWorktree,
  removeWorktree,
  worktreePath,
} from "./worktree"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  return (result.stdout ?? "").trim()
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-worktree-"))
  dirs.push(dir)
  git(dir, ["init", "-b", "main"])
  git(dir, ["config", "user.name", "test"])
  git(dir, ["config", "user.email", "test@example.com"])
  // Deterministic file contents regardless of the developer's global git config.
  git(dir, ["config", "core.autocrlf", "false"])
  writeFileSync(path.join(dir, "TASKS.md"), "- [ ] Task\n")
  writeFileSync(path.join(dir, "file.txt"), "base\n")
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-m", "init"])
  return dir
}

describe("isGitRepo", () => {
  test("true for a repo, false for a plain directory", () => {
    const repo = initRepo()
    const plain = mkdtempSync(path.join(os.tmpdir(), "tasksmd-plain-"))
    dirs.push(plain)
    expect(isGitRepo(repo)).toBe(true)
    expect(isGitRepo(plain)).toBe(false)
  })
})

describe("ensureWorktree", () => {
  test("creates the worktree on a task branch, excluded from git status", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")

    expect(info?.path).toBe(worktreePath(root, "ship-it"))
    expect(info?.branch).toBe("task/ship-it")
    expect(info?.base).toBe("main")
    expect(existsSync(info!.path)).toBe(true)
    expect(git(info!.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("task/ship-it")
    expect(git(root, ["status", "--porcelain"])).toBe("")
  })

  test("reuses the existing worktree", () => {
    const root = initRepo()
    const first = ensureWorktree(root, "ship-it")
    writeFileSync(path.join(first!.path, "note.txt"), "here\n")

    const second = ensureWorktree(root, "ship-it")
    expect(second?.path).toBe(first!.path)
    expect(readFileSync(path.join(second!.path, "note.txt"), "utf-8")).toBe("here\n")
  })

  test("recreates a stale checkout that ended up on another branch", () => {
    const root = initRepo()
    const first = ensureWorktree(root, "ship-it")
    git(first!.path, ["checkout", "-b", "something-else"])

    const second = ensureWorktree(root, "ship-it")
    expect(git(second!.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("task/ship-it")
  })
})

describe("hasChanges and commitsAhead", () => {
  test("clean worktree has no changes and none ahead", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    expect(hasChanges(info, "main")).toBe(false)
    expect(commitsAhead(info, "main")).toBe(0)
  })

  test("uncommitted work counts as changes, committed work counts as ahead", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    writeFileSync(path.join(info.path, "new.txt"), "work\n")
    expect(hasChanges(info, "main")).toBe(true)
    expect(commitsAhead(info, "main")).toBe(0)

    commitAll(info, "ship-it")
    expect(git(info.path, ["status", "--porcelain"])).toBe("")
    expect(commitsAhead(info, "main")).toBe(1)
    expect(hasChanges(info, "main")).toBe(true)
  })
})

describe("commitAll", () => {
  test("restores TASKS.md so board edits never merge", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    writeFileSync(path.join(info.path, "TASKS.md"), "- [!] Tampered\n")
    writeFileSync(path.join(info.path, "new.txt"), "work\n")

    commitAll(info, "ship-it")
    expect(readFileSync(path.join(info.path, "TASKS.md"), "utf-8")).toBe("- [ ] Task\n")
    expect(commitsAhead(info, "main")).toBe(1)
    expect(git(info.path, ["show", "--format=", "--name-only", "HEAD"])).toBe("new.txt")
  })

  test("no-op when there is nothing to commit", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    commitAll(info, "ship-it")
    expect(commitsAhead(info, "main")).toBe(0)
  })
})

describe("mergeWorktree", () => {
  test("merges the task branch into the base with a merge commit", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    writeFileSync(path.join(info.path, "new.txt"), "work\n")
    commitAll(info, "ship-it")

    expect(mergeWorktree(root, info, "main")).toBe("merged")
    expect(readFileSync(path.join(root, "new.txt"), "utf-8")).toBe("work\n")
    expect(git(root, ["log", "-1", "--format=%s"])).toContain("Merge task 'task/ship-it'")
  })

  test("reports a conflict and aborts, leaving main clean", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    writeFileSync(path.join(info.path, "file.txt"), "from worktree\n")
    commitAll(info, "ship-it")

    writeFileSync(path.join(root, "file.txt"), "from main\n")
    git(root, ["add", "-A"])
    git(root, ["commit", "-m", "main moves"])

    expect(mergeWorktree(root, info, "main")).toBe("conflict")
    expect(git(root, ["status", "--porcelain"])).toBe("")
    expect(readFileSync(path.join(root, "file.txt"), "utf-8")).toBe("from main\n")
  })

  test("reports wrong-branch when the main checkout moved off the base", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    writeFileSync(path.join(info.path, "new.txt"), "work\n")
    commitAll(info, "ship-it")

    git(root, ["checkout", "-b", "other"])
    expect(mergeWorktree(root, info, "main")).toBe("wrong-branch")
    expect(existsSync(path.join(root, "new.txt"))).toBe(false)
  })
})

describe("removeWorktree", () => {
  test("removes the worktree and deletes the merged branch", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    writeFileSync(path.join(info.path, "new.txt"), "work\n")
    commitAll(info, "ship-it")
    mergeWorktree(root, info, "main")

    removeWorktree(root, info)
    expect(existsSync(info.path)).toBe(false)
    expect(git(root, ["branch", "--list", "task/ship-it"])).toBe("")
  })
})

describe("resolveProjectRoot", () => {
  test("maps a worktree directory back to the main checkout", () => {
    const root = initRepo()
    const info = ensureWorktree(root, "ship-it")!
    expect(resolveProjectRoot(info.path)).toBe(path.resolve(root))
    expect(resolveProjectRoot(root)).toBe(path.resolve(root))
  })

  test("a non-git directory is its own root", () => {
    const plain = mkdtempSync(path.join(os.tmpdir(), "tasksmd-plain-"))
    dirs.push(plain)
    expect(resolveProjectRoot(plain)).toBe(path.resolve(plain))
  })
})
