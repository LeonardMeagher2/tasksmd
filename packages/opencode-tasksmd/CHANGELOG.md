# @leonardmeagher2/opencode-tasksmd

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
