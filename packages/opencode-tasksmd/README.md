# OpenCode Tasks

OpenCode Tasks adds a simple background work queue to your OpenCode project.
Add work to `TASKS.md`, and OpenCode works through it in the background.

## What It Does

- Lets OpenCode pick up pending tasks automatically.
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

Indented subtasks stay under their parent task.

## Task States

```text
[ ]  Waiting
[~]  In progress
[x]  Done
[!]  Blocked
```

OpenCode marks work in progress. The task agent marks work done with
`tasks_done` after checking the result, or blocked with `tasks_blocked`.

## Settings

### Board Defaults

Add optional defaults at the top of `TASKS.md`:

```md
---
every: 5 minutes
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
agent: build
max_active: 1
tools:
  webfetch: false
  bash: false
permission:
  bash: deny
---
```

`every` sets a repeat schedule. On the board, it checks for new pending work at
that interval. In a linked task file, it runs that task again on the interval.
Use `false` or `0` to disable it. Examples: `5 minutes`, `1h`, `3600`, `false`.

`model` sets the default model.

`agent` sets which OpenCode agent runs tasks. By default, tasks use your main
agent.

`max_active` limits how many tasks run at the same time.

`tools` turns tools on or off for the task session. The plugin always keeps
`tasks_done` and `tasks_blocked` on, and `tasks_debug` off. Other tools use the
agent's normal defaults.

`permission` sets what the task may do: `allow`, `ask`, or `deny`.
In this plugin, attached sessions do not use these rules. The standalone CLI
path passes them through.

### Linked Task Files

Linked task files can override the model and agent, and can use stricter
permissions for that task.

## Sessions

When OpenCode is already running, task sessions use it and appear with your
other sessions. When it is closed, tasks still run on their own.

## Controls

Your agent can use `tasks_start` to sync schedulers and run pending work now.

Or `tasks_stop` to stop background processing and remove all
schedulers.
