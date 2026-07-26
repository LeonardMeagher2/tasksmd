# @leonardmeagher2/opencode-tasksmd

## 0.10.1

### Patch Changes

- Fix worker task state writes so `TASKS.md` no longer accumulates extra trailing blank lines on each update.

## 0.10.0

### Minor Changes

- dc0f51c: Run the board top to bottom, and remember when recurring tasks last ran.

  Selection was two passes: resume every active task first, then start the first
  pending one. Tasks with their own `every` were skipped entirely and left to a
  timer, so a recurring check could not preempt the queue, and nothing recorded
  when it last ran — the interval lived only in an in-memory `setInterval`, which
  reset on restart and never caught up a missed tick.

  Selection is now a single walk down the board, taking the first task that can
  run right now:

  - a task with its own `every` runs when it is due again, whatever its state;
  - an active task is resumed;
  - a pending task starts, if `max_active` leaves room;
  - a task whose session is still working is passed over, not waited on.

  Position decides order. Being due never lets a recurring task jump ahead of
  work above it — putting recurring tasks at the top of the board is what makes
  them run before the rest.

  `max_active` now caps sessions that are working rather than `[~]` markers on
  the board, recurring tasks included. A task left marked active with an idle
  session — or no session at all — no longer blocks the queue behind it, and a
  task dispatched moments ago holds its slot until the runtime reports its
  session, so a check landing in that gap cannot start work over the limit.

  `max_active: false` or `0` now removes the limit, as it does for `every`. Any
  other value that is not a whole number above zero falls back to 1 instead of
  quietly uncapping the board.

  Due-ness is read from a new `last_run` in stored state, written on every
  dispatch including failures. Schedules now survive a restart, a missed interval
  is caught up on the next tick instead of being dropped, and a recurring task
  that keeps failing waits out its interval rather than retrying every tick.

  State also moves out of its own hash-named folder and into a single file named
  after the project: `<state root>/opencode-tasksmd/spyro-web.json`, with logs at
  `<tmp>/opencode-tasksmd/spyro-web.log`. Existing state is moved across on first
  read and the empty folder removed. Projects that share a directory name now
  share a state file.

  `tasks_debug` and `tasksmd-debug` report `last_run` and whether each schedule
  is due.

## 0.9.1

### Patch Changes

- 825711d: Fix `auto_approve`, which had no effect.

  It was implemented with the `permission.ask` plugin hook. OpenCode declares that
  hook in its plugin types and lists it in its docs, but never calls it — the
  plugin dispatcher is only ever invoked for `chat.*`, `command.execute.before`,
  `shell.env`, `tool.*` and the `experimental.*` hooks. Permission requests are
  resolved entirely from the session's ruleset, so nothing the plugin returned was
  ever read. In 0.8.x this was masked for standalone runs, which passed `--auto` on
  the command line; 0.9.0 removed that path and made `auto_approve` dead
  everywhere.

  It now works through the ruleset instead. Before prompting, the plugin reads the
  permissions already in effect for the task's agent — OpenCode's defaults, the
  agent's own rules, and the user's config — and re-applies them to the task's
  session with every `ask` changed to `allow`. `deny` rules are re-applied
  unchanged, so anything denied stays denied. If the agent's permissions cannot be
  read, `auto_approve` is skipped and the run continues rather than failing.

  This matters for fewer permissions than it might seem: OpenCode already allows
  most things by default. What it actually covers is reaching outside the project
  directory, reading `.env` files, `doom_loop`, and anything the user's own config
  marks `ask`.

  Also fix rule precedence. OpenCode resolves a permission by taking the _last_
  matching rule, and the plugin emitted frontmatter rules in declaration order, so
  precedence depended on YAML key order:

  - `permission: { bash: deny, "*": allow }` silently lost the `bash` deny.
  - `permission: { bash: { "git *": allow, "*": deny } }` denied `git push`.

  Rules are now ordered least specific first, so a narrower rule always beats a
  broader one however they are written. The plugin's own rules are still emitted
  last, so a board cannot grant a task session control over the scheduler or hide
  its own status tools.

## 0.9.0

### Minor Changes

- 465dcd4: Run background tasks inside the OpenCode runtime instead of spawning processes
  and registering OS schedulers.

  Task runs now go through the plugin's own session API. The plugin no longer
  shells out to `opencode run`, no longer installs a `worker.mjs` asset into
  `.opencode/tasks/`, and no longer registers Windows Scheduled Tasks, macOS
  launchd agents, or systemd user timers. Recurring `every` schedules are driven
  by in-process timers for as long as OpenCode is running.

  **Scheduling is now off when OpenCode starts.** Use `tasks_start` to enable it
  for the current runtime and `tasks_stop` to disable it. It also stops when
  OpenCode closes — tasks no longer run while OpenCode is shut down. This is the
  main behavioral change: previously registered OS schedulers kept working
  independently of the editor.

  Other changes that follow from this:

  - A task's session is looked up once per run. A stored session that the runtime
    no longer knows is dropped so the run starts fresh, instead of sending a
    "continue the task" prompt to a brand new session.
  - Runs are serialised per project, and a skipped or failed run is written to the
    worker log rather than discarded silently.
  - `tasks_debug` reports runtime scheduler state and session API connectivity in
    place of scheduler registration and worker asset paths. The standalone
    `debug` CLI reports only what it can see on disk, since it runs outside the
    runtime.
  - Task tools are no longer gated by a `config` hook. Tool access is decided per
    session instead: the task status tools check that the session owns a task, and
    `tasks_start`/`tasks_stop`/`tasks_debug` are denied on task sessions through
    session permission rules. The previous hook forced these tools on, which
    overrode `tools` settings in a user's own OpenCode config.
  - `auto_approve` is applied through the permission hook only; the removed
    standalone path had passed it as a CLI flag.

  Stored state (`state.json`) drops `schedulers`, `server_url`, `server_password`,
  and the per-task `status` and `pid` fields. Per-task `sessions` becomes a single
  `session_id`; existing records are migrated on read, so no manual step is
  needed.

  **Upgrading from 0.8.x or earlier requires a manual cleanup.** Schedulers
  registered by the old version are not removed automatically, and the
  `.opencode/tasks/worker.mjs` they run is self-contained, so it keeps working
  after the upgrade. Left in place it will run tasks on the old schedule, against
  the old state format, alongside the new in-runtime scheduler — the same task can
  be started twice.

  Remove them once, per project. First delete `.opencode/tasks/`, then:

  - Windows: `schtasks /Delete /TN "OpenCodeTasks-*" /F`
  - macOS: unload and delete `~/Library/LaunchAgents/com.opencode.tasksmd.worker.*.plist`
  - Linux: `systemctl --user disable --now "opencode-tasksmd-*.timer"`, then remove
    the unit files from `~/.config/systemd/user/`

### Patch Changes

- Updated dependencies [465dcd4]
  - @leonardmeagher2/tasksmd@0.5.0

## 0.8.2

### Patch Changes

- 3a29710: Include linked task file content in fresh worker prompts, with truncation at 6000 characters.

  Fresh prompts now include a "Linked task context" section when a task links to a Markdown file.
  Long linked content is truncated with a clear marker, while resume and recurring prompts stay unchanged.

- 9a731b2: Track multiple session IDs per task instead of a single session.

  This updates task session resolution so task tools and auto-approve checks can
  resolve a task slug from any recorded session tied to that task.

## 0.8.1

### Patch Changes

- Ship a bundled `tasksmd-writing` skill with the plugin and install it into
  `.opencode/skills/tasksmd-writing/SKILL.md` when missing.

  The installer preserves workspace customizations by not overwriting an existing
  skill file.

  Also include packaged skill assets in publish output and document the bundled
  skill behavior in the README.

## 0.8.0

### Minor Changes

- Sub-agent spawning (`task` permission) now defaults to `deny` for task sessions
  unless the task frontmatter explicitly sets a `task` permission rule.
  Previously task agents could spawn sub-agents without restriction; now they must
  opt in with `permission: { task: allow }` or a per-agent glob pattern like
  `permission: { task: { explore: "allow" } }`.

## 0.7.1

### Patch Changes

- Fix attached task worker sessions to use the v2 OpenCode SDK session API so session permission rules are sent in the supported request shape. Existing session permissions are preserved when task-specific rules are added, preventing HTTP content-type decode errors while creating or updating attached task sessions.

## 0.7.0

### Minor Changes

- Add `auto_approve` frontmatter option. When true, permission requests for the
  task's session are auto-approved (like `opencode run --auto`); rules set to
  `deny` still apply. Works at board and linked-task-file level.

## 0.6.2

### Patch Changes

- Stop task agents from being able to call tasks_stop and tasks_start

## 0.6.1

### Patch Changes

- Improve task worker session reuse and recovery, add the `task_info` tool, rename task runner tools to `task_done` and `task_blocked`, and clarify task prompts and worker diagnostics.

## 0.6.0

### Minor Changes

- Improve task worker sessions and prompts. Reuse task sessions across recurring and manually reset runs, recover when a stored session is unavailable, and add clearer task status instructions with the `task_done`, `task_blocked`, and `task_info` tools. Add worker diagnostics for task schedulers and session state.

## 0.5.1

### Patch Changes

- Updated dependencies
  - @leonardmeagher2/tasksmd@0.4.0

## 0.5.0

### Minor Changes

- Fix task permission model

## 0.4.0

### Minor Changes

- Add tool customization per task

## 0.3.1

### Patch Changes

- Add missing readme?

## 0.3.0

### Minor Changes

- Get all tasks working

### Patch Changes

- Updated dependencies
  - @leonardmeagher2/tasksmd@0.3.0
