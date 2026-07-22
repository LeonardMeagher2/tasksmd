---
name: tasks
description: Manage the project task board (TASKS.md)
---

# Tasks

This project uses `TASKS.md` as a task board. The worker processes tasks one at a time.

## TASKS.md format

Frontmatter for config:

```yaml
---
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
max_active: 1
permission:
  bash: deny
---
```

Task permissions can use `allow`, `ask`, or `deny`.

Checkboxes:

| State | Meaning |
|-------|---------|
| `- [ ] text` | Pending — worker will pick this up |
| `- [~] text` | In progress — worker is running it |
| `- [x] text` | Done |
| `- [!] text` | Blocked — worker will not prompt it |

## Adding tasks

Small tasks go inline:

```
- [ ] Implement rate limiting middleware
```

Large tasks get their own file anywhere in the project and linked from the board:

```
- [ ] [Rewrite auth system](docs/rewrite-auth.md)
```

The linked file has frontmatter (optional `model` override) and the full prompt as body:

```markdown
---
model: ollama/unsloth/Qwen3.5-1.5B-GGUF:Q4_K_M
---

Rewrite the auth system from session cookies to JWT tokens.

Acceptance criteria:
- Login endpoint returns signed JWT
- ...
```

## Rules

- Only add tasks to TASKS.md (append `- [ ]` lines)
- Worker state lives outside the project.
- Worker-managed markers describe execution status.
- Task agents update their own status with the `tasks_done` and `tasks_blocked` tools.
