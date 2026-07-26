---
"@leonardmeagher2/opencode-tasksmd": minor
---

Run background tasks inside the OpenCode runtime instead of spawning processes
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
