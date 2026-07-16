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
model: unsloth/Qwen3.5-9B-GGUF:Q4_K_M
max_active: 1
---
```

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

Large tasks get their own file in `.tasks/` and linked from the board:

```
- [ ] [Rewrite auth system](.tasks/rewrite-auth.md)
```

The linked file has frontmatter (optional `model` override) and the full prompt as body:

```markdown
---
model: unsloth/Qwen3.5-1.5B-GGUF:Q4_K_M
---

Rewrite the auth system from session cookies to JWT tokens.

Acceptance criteria:
- Login endpoint returns signed JWT
- ...
```

## Rules

- Only add tasks to TASKS.md (append `- [ ]` lines)
- Do not edit `.tasks/.state/` files — those are the worker's private state
- Do not modify `[~]` or `[x]` markers — the worker handles those
- Use `/tasks` to reload this skill

## Executing A Task

When the worker gives you a task, execute it in the current project.

For a linked task, read the referenced task file first. It contains the full request and acceptance criteria.

- Use your tools and make the requested changes now.
- Do not only explain the solution or write a plan.
- Do not ask normal clarification questions. Choose a sensible minimal result and proceed.
- Inspect the relevant files before changing them.
- Verify the result before finishing.
- If you cannot finish, state the exact blocker and mark the exact task `[!]`.
- After verifying the work, mark this exact task `[x]` in `TASKS.md`.
- If incomplete but still actionable, leave it `[~]`.
