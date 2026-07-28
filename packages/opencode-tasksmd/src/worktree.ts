import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

export type WorktreeInfo = {
  path: string
  branch: string
  base: string
}

export type MergeResult = "merged" | "conflict" | "wrong-branch" | "error"

const GIT_IDENTITY = ["-c", "user.name=opencode-tasksmd", "-c", "user.email=opencode-tasksmd@localhost"]

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

const gitRepos = new Map<string, boolean>()

/** True when dir is inside a git working tree. Cached per directory. */
export function isGitRepo(dir: string): boolean {
  const resolved = path.resolve(dir)
  const cached = gitRepos.get(resolved)
  if (cached !== undefined) return cached
  const result = git(resolved, ["rev-parse", "--is-inside-work-tree"])
  const is = result.ok && result.stdout === "true"
  gitRepos.set(resolved, is)
  return is
}

export function worktreeBranch(slug: string): string {
  return `task/${slug}`
}

export function worktreePath(root: string, slug: string): string {
  return path.join(root, ".opencode", "tasks", "worktrees", slug)
}

/** The main checkout's current branch, or "HEAD" when detached. */
function currentBranch(root: string): string {
  const result = git(root, ["rev-parse", "--abbrev-ref", "HEAD"])
  return result.ok && result.stdout ? result.stdout : "HEAD"
}

/**
 * Keep worktrees out of git status without touching the repo: .git/info/exclude
 * is local to this clone and applies to every worktree of it.
 */
function ensureExclude(root: string): void {
  try {
    const gitDir = git(root, ["rev-parse", "--git-dir"])
    if (!gitDir.ok || !gitDir.stdout) return
    const exclude = path.join(path.resolve(root, gitDir.stdout), "info", "exclude")
    const entry = ".opencode/tasks/worktrees/"
    const current = existsSync(exclude) ? readFileSync(exclude, "utf-8") : ""
    if (current.split(/\r?\n/).some((line) => line.trim() === entry)) return
    mkdirSync(path.dirname(exclude), { recursive: true })
    const separator = current && !current.endsWith("\n") ? "\n" : ""
    appendFileSync(exclude, `${separator}${entry}\n`, "utf-8")
  } catch {
    // Excluding is a courtesy; failing must not break a run.
  }
}

/**
 * Create or reuse the task's worktree at .opencode/tasks/worktrees/<slug> on
 * branch task/<slug>. Returns undefined when no worktree can be prepared — the
 * caller then runs in the project root instead.
 */
export function ensureWorktree(root: string, slug: string): WorktreeInfo | undefined {
  const branch = worktreeBranch(slug)
  const target = worktreePath(root, slug)
  const base = currentBranch(root)

  if (existsSync(target) && git(target, ["rev-parse", "--is-inside-work-tree"]).ok) {
    const onBranch = git(target, ["rev-parse", "--abbrev-ref", "HEAD"])
    if (onBranch.ok && onBranch.stdout === branch) return { path: target, branch, base }
    // Stale checkout of something else — drop it and start clean.
    git(root, ["worktree", "remove", "--force", target])
  }

  ensureExclude(root)
  git(root, ["worktree", "prune"])

  // Fresh branch when possible; attach the existing one after an interrupted run.
  let created = git(root, ["worktree", "add", target, "-b", branch, base])
  if (!created.ok) created = git(root, ["worktree", "add", target, branch])
  if (!created.ok) return undefined
  return { path: target, branch, base }
}

export function commitsAhead(info: WorktreeInfo, base: string): number {
  const ahead = git(info.path, ["rev-list", "--count", `${base}..HEAD`])
  const count = Number(ahead.stdout)
  return ahead.ok && Number.isFinite(count) ? count : 0
}

/** Changes in the worktree: uncommitted work, or commits the base doesn't have. */
export function hasChanges(info: WorktreeInfo, base: string): boolean {
  if (git(info.path, ["status", "--porcelain"]).stdout !== "") return true
  return commitsAhead(info, base) > 0
}

/**
 * Commit any uncommitted work. TASKS.md is restored first: board markers live
 * in the main checkout, so an agent edit here must never reach the merge.
 */
export function commitAll(info: WorktreeInfo, slug: string): void {
  git(info.path, ["checkout", "--", "TASKS.md"])
  if (git(info.path, ["status", "--porcelain"]).stdout === "") return
  git(info.path, ["add", "-A"])
  git(info.path, [...GIT_IDENTITY, "commit", "-m", `task: ${slug}`])
}

/** Merge the task branch into its base branch in the main checkout. */
export function mergeWorktree(root: string, info: WorktreeInfo, base: string): MergeResult {
  if (base !== "HEAD" && currentBranch(root) !== base) return "wrong-branch"
  const merged = git(root, ["merge", "--no-ff", "-m", `Merge task '${info.branch}'`, info.branch])
  if (merged.ok) return "merged"
  const conflicts = git(root, ["diff", "--name-only", "--diff-filter=U"])
  git(root, ["merge", "--abort"])
  return conflicts.stdout ? "conflict" : "error"
}

/** Remove the worktree and delete the (merged) task branch. */
export function removeWorktree(root: string, info: WorktreeInfo): void {
  git(root, ["worktree", "remove", info.path])
  if (existsSync(info.path)) git(root, ["worktree", "remove", "--force", info.path])
  git(root, ["branch", "-d", info.branch])
}
