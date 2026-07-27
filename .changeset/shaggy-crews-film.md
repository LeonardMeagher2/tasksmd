---
"@leonardmeagher2/opencode-tasksmd": patch
---

Improve `task_info` output with task location and linked-task context.

`task_info` now includes the task's line in `TASKS.md` and, when linked content
exists, the same linked-task context block used by the first prompt. It also no
longer throws when a linked path is missing or unreadable, and reports those
states explicitly instead.
