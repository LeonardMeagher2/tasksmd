---
"@leonardmeagher2/opencode-tasksmd": minor
---

Add opt-in per-task git worktrees with auto-merge and session panic.

`worktree: true` on the board (or a linked task file) gives each task its own
worktree at `.opencode/tasks/worktrees/<slug>` on branch `task/<slug>`,
created from the current branch. Board, state, and task tools stay anchored
to the main checkout; the worktree's own plugin instance only provides task
tools. The directory is hidden via `.git/info/exclude`, so nothing is added
to the repo's tracked files.

When the agent calls `task_done`, uncommitted work is committed (`TASKS.md`
is restored first) and the branch is merged back with `--no-ff`. A conflict,
a dirty main checkout, or a moved base branch marks the task blocked with the
reason and keeps the branch for manual merging.
`worktree: { auto_merge: false }` keeps the branch instead.

Session panic: when a worktree task's session goes idle without producing any
change, the plugin counts it (`worktree: { attempts: n }`, default 3). At the
limit the session is deleted without touching the board, so the task starts
fresh on the next check. Any change resets the count.

Session busy-checks now follow each session's own directory, so a busy
worktree session is never double-dispatched. `tasks_debug` reports per-task
worktree status. Projects that are not git repos fall back to running in the
project root.
