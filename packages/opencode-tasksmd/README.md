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
task calls `task_done` after checking its result — with no reason to mark the
task done, or with a reason to mark it blocked. The agent can call `task_info`
at any time to re-read its task.

## Order of Work

Each time it checks, OpenCode reads the board from top to bottom and takes the
first task it can run right now:

- a task with its own `every` runs when it is due again;
- a task in progress is continued;
- a waiting task starts.

A task that is still running is skipped rather than waited on, and the check
moves down the board. Blocked tasks are left alone.

Position decides order, so a recurring task at the top of the board runs before
the work below it. Being due does not let it jump ahead of a task above it.

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
- may not call `tasks_start`, `tasks_stop`, or `tasks_debug`.

These rules are applied last, so a board cannot override them: a task can
report its own status, but it cannot control the scheduler.

### Linked Task Files

Settings in a linked task file override the board's defaults for that task. A
linked file can set `every`, `model`, `agent`, `auto_approve`, and
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
- `tasks_debug`: show a diagnostic report — board summary, saved run state,
  scheduler status, connection to OpenCode, the next waiting task, and recent
  worker log lines.

For the agent running a task:

- `task_done`: finish the task. With no reason it marks the task done; with a
  reason it marks the task blocked.
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
