---
name: tasksmd-writing
description: Write and format TASKS.md boards and linked task files. Use when creating task lists, nested subtasks, task detail docs, or clarifying non-OpenCode TASKS.md structure.
---

# TASKS.md Tasking

Use this skill when writing or editing `TASKS.md` and linked task files.

## TASKS.md format (tool-agnostic)

`TASKS.md` is Markdown with optional YAML frontmatter at the top.

Task lines use checkbox markers:

- `[ ]` pending
- `[~]` active
- `[x]` done
- `[!]` blocked

Task line syntax:

- Plain task
  - `- [ ] Add health check`
- Linked task file
  - `- [ ] [Rewrite auth flow](tasks/rewrite-auth.md)`
- Subtasks
  - indent under a parent task using spaces (commonly 2)
  - `- [ ] Parent`
  - `  - [ ] Child`

Frontmatter is free-form. `tasksmd` itself does not reserve keys. Tools that
consume `TASKS.md` may define extra keys.

## Frontmatter behavior

Frontmatter is YAML between `---` markers at the top of a Markdown file.

Board-level example in `TASKS.md`:

```md
---
every: 5 minutes
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
agent: build
max_active: 1
auto_approve: false
permission:
  bash: deny
---
```

Linked task file example:

```md
---
every: false
watch:
  paths:
    - src/**
  ignore:
    - node_modules/**
    - .git/**
    - dist/**
    - TASKS.md
model: anthropic/claude-sonnet-4-6
permission:
  read: allow
  edit: ask
---
```

`watch` also accepts a string or list of paths. In object form, `ignore`
replaces the default exclusions; see the package README for details.

How it works:

1. `TASKS.md` frontmatter is the default for all tasks on that board.
2. If a task links to another Markdown file, that file's frontmatter overlays
   the board frontmatter for that task.
3. Overlay is a deep merge, with linked-file values winning on conflicts.

OpenCode Tasks reads `watch` only from linked task files. Board-level `watch`
is ignored and is not inherited.

Practical rule: put shared defaults on the board, and task-specific overrides
in linked files.

### Watch behavior

`watch` accepts one path, a list of paths, or an object with `paths` and
`ignore`. Paths resolve from the project root; absolute paths and paths outside
the root (such as `../shared/**`) are also supported. Matching a directory
watches its contents.

By default, `.git`, `node_modules`, `dist`, and `TASKS.md` are ignored. In
object form, `ignore` replaces that list; use `ignore: []` to disable the
defaults.

Added, changed, or deleted paths trigger the task. Bursts are coalesced. If
`every` is also set, both the interval and a file change must be due. A pending
trigger survives `tasks_stop` and runs after the next `tasks_start`; changes
made while stopped are not seen. Avoid watching paths the task itself writes,
or it may trigger itself repeatedly.

## Writing linked task files

Use linked files for larger tasks that need context or acceptance checks.

Recommended shape:

```md
---
title: Rewrite auth flow
---

# Goal

One clear outcome.

# Context

Important files, constraints, and known pitfalls.

# Acceptance Criteria

- Behavior and output checks that must be true
- Any required tests or commands

# Notes

Optional implementation hints.
```

Keep the board task short and put detail in the linked file.

## Start here when unsure

1. Parse the board state markers and hierarchy first.
2. Read each linked task file before changing code.
3. Extract acceptance criteria into a short checklist.
4. Make the smallest change that satisfies that checklist.
5. Verify before marking completion.

If ambiguity changes the outcome, ask one focused question.

## Parameters and schema guidance

This skill covers non-OpenCode `TASKS.md` structure and authoring guidance.

For frontmatter keys interpreted by `opencode-tasksmd` (`every`, `watch`,
`model`, `agent`, `max_active`, `auto_approve`, `permission`), use the package README:

- `packages/opencode-tasksmd/README.md`

For OpenCode config shapes (for example `permission`, `agent`, `model`, and
other config object formats), use the official schema:

- https://opencode.ai/config.json
