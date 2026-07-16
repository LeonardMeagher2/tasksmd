# Tasks

A per-project task queue for OpenCode. The agent edits `TASKS.md` with its built-in file tools. A worker processes tasks one at a time.

No custom tools required. No daemon. Just a file, a skill, and a cron job.

---

## How it works

```
TASKS.md     ← the board (frontmatter config + checkbox list)
.tasks/      ← linked task files for large tasks

Worker (cron every 5 min):
  └─ Read TASKS.md, find first [ ] or stale [~]
  └─ Get prompt from inline text or linked .tasks/<name>.md
  └─ cd to worktree
  └─ opencode run --model <m> -p "<prompt>"
  └─ Mark [ ] → [~] while running, [~] → [x] on success
```

---

## Project structure

```
<project>/
├── .opencode/
│   ├── skills/
│   │   └── tasks/
│   │       └── SKILL.md         ← teaches agent the format (/tasks)
│   ├── plugins/
│   │   └── task-queue.ts        ← optional V1 plugin
│   └── tasks/
│       └── worker.sh            ← the worker script
├── TASKS.md                     ← the board (project root)
└── .tasks/                      ← linked task files for large tasks
```

---

## TASKS.md format

```markdown
---
model: unsloth/Qwen3.5-9B-GGUF:Q4_K_M
max_active: 1
---

- [ ] Implement rate limiting middleware
- [~] [Rewrite auth system](.tasks/rewrite-auth.md)
- [x] Refactor database connection
- [ ] Write API docs
```

### Frontmatter

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `model` | no | opencode's default | Default model for all tasks |
| `max_active` | no | 1 | Max `[~]` tasks allowed at once |

### Checkbox states

| State | Meaning |
|-------|---------|
| `- [ ]` | Pending — worker will pick this |
| `- [~]` | In progress — worker is running this, or crashed and left stale |
| `- [x]` | Done |

### Inline tasks

The line text after the checkbox is the prompt. Uses the default `model` from frontmatter.

```
- [ ] Implement rate limiting middleware
```

### Linked tasks (large tasks)

```
- [ ] [Rewrite auth system](.tasks/rewrite-auth.md)
```

The linked `.tasks/rewrite-auth.md` file has its own frontmatter:

```markdown
---
model: unsloth/Qwen3.5-1.5B-GGUF:Q4_K_M
---

Rewrite the auth system from session cookies to JWT tokens.

Acceptance criteria:
- Login endpoint returns signed JWT
- Middleware validates on protected routes
- Refresh token flow works
- All existing tests pass
```

Resolution order for `model`:
1. Task file's frontmatter `model` (if linked)
2. TASKS.md frontmatter `model`
3. opencode's default model

---

## Worker script (`.opencode/tasks/worker.sh`)

One task per tick. Called by cron every 5 minutes.

```
1. Read TASKS.md frontmatter
2. Prioritize stale [~] tasks first, then first [ ]
3. If count([~]) >= max_active or no task found → exit
4. Resolve prompt + model (inline or linked)
5. git worktree add .worktrees/<slug> <base>
6. Replace [ ] → [~] in TASKS.md
7. cd .worktrees/<slug>
8. opencode run --format json --title "task:<slug>" \
     ${model:+--model "$model"} -p "$prompt"
9. On success: [~] → [x], optionally commit worktree
10. On failure: leave [~] — visible stuck state
```

### Crash recovery

If the worker crashes, TASKS.md is left with `[~]`. Next tick sees it, checks if the worktree exists, retries. You can also manually reset `[~]` → `[ ]` to force a fresh attempt.

---

## Cron job

```bash
schedule_job \
  --name "task-worker" \
  --schedule "*/5 * * * *" \
  --command "bash .opencode/tasks/worker.sh" \
  --workdir "/path/to/project"
```

One per project that opts in.

---

## Skill (`/tasks`)

`.opencode/skills/tasks/SKILL.md` teaches the agent:

- TASKS.md is this project's task board
- Format: frontmatter config + checkbox list
- Add tasks by editing TASKS.md with normal file tools
- Small tasks: `- [ ] <prompt>` inline
- Large tasks: create `.tasks/<name>.md`, link it: `- [ ] [<name>](.tasks/<name>.md)`
- Background worker picks up `[ ]` tasks one at a time
- Use `/tasks` to load this skill

No custom tools needed. The agent uses `read`, `write`, `edit`, `patch` directly.

---

## V1 Plugin (optional)

`.opencode/plugins/task-queue.ts`. Adds convenience, not required.

| Hook | Purpose |
|------|---------|
| `tool.execute.after` | Detect TASKS.md edits during session |
| `session.idle` | Nudge about pending tasks |
| `queue_task` tool | Validate and append task to TASKS.md |
| `tasks` tool | Show current board status |

---

## Daily workflow

**In an opencode session:**
```
/tasks
"Add a task to implement rate limiting"
→ agent appends: - [ ] Implement rate limiting middleware
```

**From your phone:**
Edit TASKS.md directly — add tasks, mark done, reset stuck tasks.

**Worker runs in background:**
Every 5 min, picks up next task, works through it. You get back to a TASKS.md with `[x]` entries.

---

## V2 evolution

When opencode 2 ships:

- Replace cron + worker.sh with a V2 plugin
- `ctx.session.create()` + `ctx.session.prompt()` — named sessions per task, resume on retry
- No subprocess, no second model load
- Plugin hooks `file.edited` + `session.idle` for instant processing instead of polling

Same TASKS.md format. Same skill. Just swap the executor.

---

## Reference links

| Resource | Link |
|----------|------|
| OpenCode plugin API (V1) | https://opencode.ai/docs/plugins |
| Custom tools | https://opencode.ai/docs/custom-tools |
| CLI reference (`opencode run`) | https://opencode.ai/docs/cli |
| Skills | https://opencode.ai/docs/skills |
| OpenCode plugin dev guide | https://devcxl.cn/en-us/blog/opencode-plugin-development-guide |
| OpenCode Book — plugin deep dive | https://www.opencodebook.xyz/en/chapter_13_plugin_system/13.1_plugin_interface_definition |
| `@opencode-ai/plugin` on npm | https://www.npmjs.com/package/@opencode-ai/plugin |
| GitHub — anomalyco/opencode | https://github.com/anomalyco/opencode |
