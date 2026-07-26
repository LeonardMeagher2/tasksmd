---
"@leonardmeagher2/opencode-tasksmd": minor
---

Run the board top to bottom, and remember when recurring tasks last ran.

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
