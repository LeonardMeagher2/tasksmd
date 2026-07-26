---
"@leonardmeagher2/opencode-tasksmd": patch
---

Fix `auto_approve`, which had no effect.

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

Also fix rule precedence. OpenCode resolves a permission by taking the *last*
matching rule, and the plugin emitted frontmatter rules in declaration order, so
precedence depended on YAML key order:

- `permission: { bash: deny, "*": allow }` silently lost the `bash` deny.
- `permission: { bash: { "git *": allow, "*": deny } }` denied `git push`.

Rules are now ordered least specific first, so a narrower rule always beats a
broader one however they are written. The plugin's own rules are still emitted
last, so a board cannot grant a task session control over the scheduler or hide
its own status tools.
