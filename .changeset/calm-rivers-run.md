---
"@leonardmeagher2/opencode-tasksmd": minor
---

Improve the tool APIs.

- `task_done`'s `reason` argument is renamed to `blocked_reason`, so a task is
  only marked blocked on purpose. This is a breaking change to the tool's
  schema.
- Blocked reasons are now kept in task state and shown by `tasks_debug` and
  the blocked notification. Marking a task done clears its stored reason.
- New `tasks_run` tool runs one task now by slug, whether schedulers are on or
  off. It refuses blocked tasks and declines while another run is in flight.
  Task sessions are denied `tasks_run`, like the other scheduler tools.
