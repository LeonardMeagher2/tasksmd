# OpenCode Tasks

OpenCode Tasks gives your project a simple work queue. Add work to `TASKS.md`, and OpenCode works through it in the background.

## Install

Add the plugin to your OpenCode config:

```json
{
  "plugin": ["@leonardmeagher2/opencode-tasksmd"]
}
```

Restart OpenCode. The plugin installs the background worker for the project.

## Why Use It

- Keep work in the project, next to the code.
- Let OpenCode pick up tasks while you are away.
- See task progress in `TASKS.md`.
- Continue unfinished work instead of starting over.
- Limit how many tasks run at once.
- Keep blocked work visible without retrying it forever.

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

Indented subtasks stay with their parent task and are handled in one session.

## Task Progress

```text
[ ]  Waiting
[~]  In progress
[x]  Done
[!]  Blocked
```

OpenCode marks work in progress. The task agent marks its own work done with the `tasks_done` tool after checking the result, or blocked with `tasks_blocked`. Blocked tasks stay visible and are not retried.

## Settings

Add optional defaults at the top of `TASKS.md`:

```md
---
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
agent: build
max_active: 1
permission:
  bash: deny
---
```

`model` chooses the default model.

`agent` chooses which OpenCode agent runs tasks. By default, tasks run with your primary agent.

`max_active` limits concurrent work.

`permission` sets task-level `allow`, `ask`, or `deny` rules.

Linked task files can override the model and agent, and add stricter permissions for that task.

## Sessions

When OpenCode is already running, task sessions use it and appear with your other sessions. When it is closed, tasks still run on their own.

## Controls

Use `tasks_start` to reconcile schedulers and run pending work now.

Use `tasks_remove_schedules` to stop background processing and remove all schedulers.

## Development

This repo is a bun workspace with two packages:

- `packages/tasksmd` — the TASKS.md format library (`@leonardmeagher2/tasksmd`, see its own README).
- `packages/opencode-tasksmd` — the OpenCode plugin (`@leonardmeagher2/opencode-tasksmd`).

Run `bun install` once, then `bun test` and `bun run build` from the repo root.

Releasing uses [changesets](https://github.com/changesets/changesets):

1. `bun run change` — describe your changes and pick the bump per package.
2. `bun run version` — consume pending changesets, bump versions, update changelogs.
3. `bun run release` — publish both packages to npm in dependency order.

For local development, `bun run dev` builds a self-contained plugin bundle at
`.opencode/plugins/tasks.js` (all dependencies inlined, like published OpenCode
plugins) plus the worker asset at `.opencode/tasks/worker.js`. Restart OpenCode
to pick up changes. The bundle and skills are gitignored — rerun `bun run dev`
after editing plugin source.

To try the plugin the way an npm user would run it, build first, then point a
scratch project's `opencode.json` at the built entry:

```json
{
  "plugin": ["file:///C:/path/to/tasks/packages/opencode-tasksmd/dist/index.js"]
}
```

The built worker (`dist/worker.js`) is fully self-contained: it is copied into
the project's `.opencode/tasks/` directory and runs without any node_modules.
