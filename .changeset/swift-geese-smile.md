---
"@leonardmeagher2/tasksmd": patch
"@leonardmeagher2/opencode-tasksmd": patch
---

Align package READMEs with current tool behavior.

The `opencode-tasksmd` README now matches the current tools: blocking is done
by calling `task_done` with a reason, `task_info` output includes the task's
line and linked file content, and background work is described as starting
with `tasks_start` and stopping when OpenCode closes. The tools section is
split into session tools and task tools.

The `tasksmd` README now distinguishes state updates from structural updates
and documents the exact return values of `create`, `addTask`, and
`removeTask`.
