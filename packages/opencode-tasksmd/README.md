# OpenCode Tasks

OpenCode Tasks adds a simple background work queue to your OpenCode project.
Add work to `TASKS.md`, then call `tasks_start`. While background work is on,
OpenCode works through your tasks in the background.

## What It Does

- Lets OpenCode pick up waiting tasks automatically once background work is on.
- Shows task progress in `TASKS.md`.
- Lets unfinished work continue instead of starting over.
- Limits how many tasks run at once.
- Keeps blocked work visible without retrying it forever.

## Install

Add the plugin to your OpenCode config:

```json
{
  "plugin": ["@leonardmeagher2/opencode-tasksmd"]
}
```

## Add Work

Add a short task directly to `TASKS.md`:

```md
- [ ] Add a health check endpoint
```

For a larger task, link to a file anywhere in the project:

```md
- [ ] [Rewrite the auth flow](docs/auth-task.md)
```

The linked file can include background, details, and acceptance criteria.
On a task's first run, the worker includes the linked file's content in the
initial prompt (without its frontmatter, truncated for size) and still tells
the agent to read the full file.

Indented subtasks stay under their parent task.

## Task States

```text
[ ]  Waiting
[~]  In progress
[x]  Done
[!]  Blocked
```

OpenCode marks a task as in progress when it starts. The agent working on the
task calls `task_done` after checking its result — with no arguments to mark
the task done, or with `blocked_reason` to mark it blocked. A blocked reason
is kept and shown by `tasks_debug` and the blocked notification. The agent can
call `task_info` at any time to re-read its task.

## Order of Work

Each time it checks, OpenCode reads the board from top to bottom and takes the
first task that is *due* — one that should run when it can. A task is due when
every trigger it declares is satisfied:

- a task with its own `every` is due when its interval has elapsed (or it has
  never run);
- a task with `watch` is due when a watched path has changed since its last run;
- a task with both needs both — it re-runs at most every interval, and only when
  files changed;
- a task with neither is due by board state: in progress tasks continue, waiting
  tasks start.

A task that is still running is skipped rather than waited on, and the check
moves down the board. Blocked tasks are left alone. A due task also waits when
every `max_active` slot is taken, and starts once one frees.

Position decides order, so a recurring or watched task at the top of the board
runs before the work below it. Being due does not let it jump ahead of a task
above it.

## Settings

### Board Defaults

Add optional defaults at the top of `TASKS.md`:

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

`every` sets a repeat schedule. On the board, it tells OpenCode to check for
work at that interval. In a linked task file, it re-runs that one task at the
interval, counted from the task's last run — so a restart does not lose the
schedule, and a missed interval is picked up on the next check rather than
skipped. Use `false` or `0` to disable it. Examples: `5 minutes`, `1h`,
`3600`, `false`.

`watch` triggers a task when files change. In a linked task file, it accepts a
glob or list of globs resolved against the project root. A pattern naming a
directory — by trailing slash, or by resolving to one — watches its contents;
one matching files watches those files. The same setting covers both. By
default, `.git`, `node_modules`, `dist`, and `TASKS.md` are ignored. Paths may
also be absolute or relative to a parent directory, such as `../shared/**`.

Use object form to customize ignored paths. Supplying `ignore` replaces the
default list; `ignore: []` disables all default exclusions for that task.

```md
---
watch:
  paths:
    - src/**
    - README.md
  ignore:
    - node_modules/**
    - .git/**
    - dist/**
    - TASKS.md
---
```

When a watched path is added, changed, or deleted, the task becomes due and
runs once a `max_active` slot is free. Rapid bursts of changes are coalesced
into one run, and a trigger already pending when background work stops still
fires on the next `tasks_start` — changes made while it is off are not seen.
The task prompt names the configured watch globs that matched, so the agent
knows which part of the project to inspect.
With `every` also set, both must hold — the task re-runs at most every interval,
and only when files changed. Use `false` or `0` to disable it.

```md
---
watch:
  - src/**
  - README.md
---
```

A task that writes into its own watched paths will re-trigger itself after
every run, so keep a task's outputs outside its `watch` globs or add them to its
`ignore` list.

`model` sets the default model for task runs.

`agent` sets which OpenCode agent runs tasks. If not set, tasks use the `build`
agent when it exists, otherwise your main agent.

`max_active` limits how many tasks run at the same time, recurring tasks
included. While every slot is taken, nothing new starts. Use `false` or `0` to
work without a limit.

A task left marked `[~]` that is no longer running does not hold a slot — the
marker says a task was started, not that anything is happening.

`auto_approve` lets a task run without stopping to ask you. Every permission
request it would otherwise wait on is answered yes; anything already denied
stays denied. Only the task's session is affected — your other sessions are
untouched.

The plugin takes the permission rules already in effect for that agent —
OpenCode's defaults, the agent's own rules, and your `opencode.json` — and
applies them to the task's session with every `ask` changed to `allow`. In
practice this covers reaching outside the project directory, reading `.env`
files, and anything your own config marks `ask`.

`permission` controls what the task may do: `allow`, `ask`, or `deny`.
It covers all tool access, including command patterns such as `bash: deny`.
The rules are set on the task's session before it starts, so only that session
is affected.

A narrower rule always beats a broader one, whatever order they appear in, so
`permission` still applies on top of `auto_approve`:

```md
---
auto_approve: true
permission:
  bash:
    "*": deny
    "git *": allow
---
```

That task runs unattended, but `bash` is refused except for `git` commands.

Letting a task spawn sub-agents (the `task` permission) is denied by default
and stays denied under `auto_approve`. To opt in, set
`permission: { task: allow }`, or allow only specific agents, for example
`task: { explore: "allow" }`.

Task sessions always:

- may call `task_done` and `task_info`;
- may not call `tasks_start`, `tasks_stop`, `tasks_run`, or `tasks_debug`.

These rules are applied last, so a board cannot override them: a task can
report its own status, but it cannot control the scheduler.

### Linked Task Files

Settings in a linked task file override the board's defaults for that task. A
linked file can set `every`, `watch`, `model`, `agent`, `auto_approve`, and
`permission`.

## Sessions

Background work only runs while OpenCode is open. It is off when OpenCode
starts, and it stops when OpenCode closes.

Use `tasks_start` to turn background work on, and `tasks_stop` to turn it off.

## Tools

The plugin gives OpenCode agents these tools.

For your own sessions:

- `tasks_start`: turn on background work for this session, then start any
  waiting tasks.
- `tasks_stop`: turn background work off for this session.
- `tasks_run`: run one task now by slug, whether background work is on or off.
- `tasks_debug`: show a diagnostic report — board summary, saved run state,
  blocked reasons, scheduler status, connection to OpenCode, the next waiting
  task, and recent worker log lines.

For the agent running a task:

- `task_done`: finish the task. Call it with nothing to mark the task done,
  or with `blocked_reason` to mark the task blocked.
- `task_info`: show the task — its text, its line in `TASKS.md`, and the
  linked file's content (without its frontmatter).

## Bundled Skill

This plugin ships a default skill at:

- `.opencode/skills/tasksmd-writing/SKILL.md`

On startup, the plugin installs that file if it is missing. It does not
overwrite existing workspace edits.

The skill explains the `TASKS.md` format — which works the same with any tool —
and a safe workflow for task sessions. For the exact OpenCode config format,
see:

- https://opencode.ai/config.json
