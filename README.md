# Tasks

A per-project task queue for OpenCode. The agent adds tasks to `TASKS.md`. A worker processes them one at a time.

The agent only writes task definitions. The worker manages all execution state privately. No custom tools required. No daemon. Just a file, a skill, and a cron job.

---

## How it works

```
TASKS.md              ← the board (agent adds tasks here)
.tasks/<name>.md      ← task definition (prompt, acceptance criteria)
.tasks/.state/<name>.md ← worker's private runtime state (never touched by agent)

Worker (cron every 5 min):
  └─ Read TASKS.md, find first [ ] or stale [~]
  └─ Get prompt + model from task definition
  └─ Read .tasks/.state/<name>.md for prior context on retries
  └─ cd to worktree
  └─ opencode run --model <m> -p "<prompt>"
  └─ Dump context to .tasks/.state/<name>.md
  └─ Mark [ ] → [~] while running, [~] → [x] on success, clean up state
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
│   │   └── tasks.ts             ← auto-installs worker via launchd on load
│   └── tasks/
│       ├── worker.sh            ← worker for Unix/macOS (POSIX sh)
│       └── worker.ps1           ← worker for Windows (PowerShell)
├── TASKS.md                     ← the board (project root)
└── .tasks/
    ├── rewrite-auth.md          ← task definition (prompt, acceptance criteria)
    └── .state/
        └── rewrite-auth.md      ← worker's private runtime state
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

## Separation of concerns

| Layer | Who writes it | Contents |
|-------|--------------|----------|
| **TASKS.md** | Agent (add tasks), Worker (state transitions) | Task list, frontmatter config |
| **.tasks/\<name\>.md** | Agent (create task) | What to do, acceptance criteria |
| **.tasks/.state/\<name\>.md** | Worker only | Whatever context the worker saves |

The agent never touches `.tasks/.state/`. It only creates task definitions.

---

## Worker (`.opencode/tasks/worker.sh` / `worker.ps1`)

One task per tick. Called by cron via `bun`. Replaces the shell script — same logic, TypeScript.

```
1. Read TASKS.md frontmatter for model, max_active
2. Prioritize stale [~] tasks first (check .state/ for prior context)
   If none, find first [ ]
3. If count([~]) >= max_active or no task → exit
4. Resolve task:
   a. Inline: prompt = line text
   b. Linked: read .tasks/<name>.md → prompt = body, model = frontmatter or cascade
5. If retrying (stale [~]), read .tasks/.state/<name>.md
6. Create/verify worktree: git worktree add .worktrees/<slug> <base>
7. Replace [ ] → [~] in TASKS.md
8. cd .worktrees/<slug>
9. Run: opencode run --format json --title "task:<slug>" \
     ${model:+--model "$model"} -p "$prompt"
10. Capture session ID + output from JSON stream
11. Dump whatever context the worker has into .tasks/.state/<name>.md
12. On success: [~] → [x], remove .state/<name>.md, optionally commit worktree
13. On failure: leave [~] — state file has context for next retry
```

On retry, the worker reads the state file and injects whatever it has into the prompt. No fixed schema — the worker writes what it knows, reads what's there.

### Crash recovery

If the worker crashes mid-task:
- TASKS.md is left with `[~]`
- `.tasks/.state/<name>.md` has the last known state
- Next tick sees the stale `[~]`, reads the state file, retries with context
- You can also manually reset `[~]` → `[ ]` to force a clean retry (deletes the state file)

---

## Worker setup

When the plugin loads (on any opencode session in this project), it checks if a launchd plist exists for this project's worker. If not, it installs one — scheduling the worker to run every 5 minutes.

The worker itself never needs manual setup. Delete the plist from `~/Library/LaunchAgents/` to reset.

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

## Plugin

`.opencode/plugins/tasks.ts`. On load, auto-installs the launchd job for the worker (every 5 min). Also exposes tools for manual management:

| Tool | Purpose |
|------|---------|
| `start_tasks_worker` | Install or reinstall the launchd job (unloads first, then installs fresh) |
| `stop_tasks_worker` | Unload and remove the launchd plist |

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
