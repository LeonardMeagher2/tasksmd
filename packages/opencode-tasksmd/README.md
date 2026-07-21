# OpenCode Tasks

OpenCode Tasks gives your project a simple work queue. Add work to `TASKS.md`, and OpenCode works through it in the background.

## Install

Add the plugin to your OpenCode config:

```json
{
  "plugin": ["opencode-tasks"]
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

OpenCode marks work in progress. The task agent marks work done after checking the result. Blocked tasks stay visible and are not retried.

## Settings

Add optional defaults at the top of `TASKS.md`:

```md
---
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
max_active: 1
permission:
  bash: deny
---
```

`model` chooses the default model.

`max_active` limits concurrent work.

`permission` sets task-level `allow`, `ask`, or `deny` rules.

Linked task files can override the model and add stricter permissions for that task.

## Sessions

When OpenCode is already running, task sessions use it and appear with your other sessions. When it is closed, tasks still run on their own.

## Controls

Use `start_tasks_worker` to install or restart background processing.

Use `stop_tasks_worker` to stop background processing.
