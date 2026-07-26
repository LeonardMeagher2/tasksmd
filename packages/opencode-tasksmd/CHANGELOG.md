# @leonardmeagher2/opencode-tasksmd

## 0.8.0

### Minor Changes

- Sub-agent spawning (`task` permission) now defaults to `deny` for task sessions
  unless the task frontmatter explicitly sets a `task` permission rule.
  Previously task agents could spawn sub-agents without restriction; now they must
  opt in with `permission: { task: allow }` or a per-agent glob pattern like
  `permission: { task: { explore: "allow" } }`.

## 0.7.1

### Patch Changes

- Fix attached task worker sessions to use the v2 OpenCode SDK session API so session permission rules are sent in the supported request shape. Existing session permissions are preserved when task-specific rules are added, preventing HTTP content-type decode errors while creating or updating attached task sessions.

## 0.7.0

### Minor Changes

- Add `auto_approve` frontmatter option. When true, permission requests for the
  task's session are auto-approved (like `opencode run --auto`); rules set to
  `deny` still apply. Works at board and linked-task-file level.

## 0.6.2

### Patch Changes

- Stop task agents from being able to call tasks_stop and tasks_start

## 0.6.1

### Patch Changes

- Improve task worker session reuse and recovery, add the `task_info` tool, rename task runner tools to `task_done` and `task_blocked`, and clarify task prompts and worker diagnostics.

## 0.6.0

### Minor Changes

- Improve task worker sessions and prompts. Reuse task sessions across recurring and manually reset runs, recover when a stored session is unavailable, and add clearer task status instructions with the `task_done`, `task_blocked`, and `task_info` tools. Add worker diagnostics for task schedulers and session state.

## 0.5.1

### Patch Changes

- Updated dependencies
  - @leonardmeagher2/tasksmd@0.4.0

## 0.5.0

### Minor Changes

- Fix task permission model

## 0.4.0

### Minor Changes

- Add tool customization per task

## 0.3.1

### Patch Changes

- Add missing readme?

## 0.3.0

### Minor Changes

- Get all tasks working

### Patch Changes

- Updated dependencies
  - @leonardmeagher2/tasksmd@0.3.0
