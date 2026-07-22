# tasksmd

The simplest API for reading and modifying `TASKS.md` boards.

A `TASKS.md` board is plain Markdown: a YAML frontmatter block for
configuration, plus a checklist of tasks. It keeps a queue of work as text in
your repo — any script, CLI, or agent can pick work up and report back without
needing its own storage.

This package is the format's home. It parses boards, edits task markers
safely, reads frontmatter, and gives you an opaque handle to a single task so
your code works with tasks, not files.

tasksmd is only the format. It assigns no meaning to frontmatter keys and no
behavior to task states — the tool you build on top decides those.

## The format

```md
---
project: website
priority: high
---

- [ ] Add a health check endpoint
- [~] [Rewrite the auth flow](docs/auth-task.md)
  - [ ] Subtasks ride along with their parent
```

Frontmatter is free-form YAML; the keys above are examples, your tool defines
its own. Tasks are checkbox lines in one of four states:

| Marker | State    | Meaning        |
| ------ | -------- | -------------- |
| `[ ]`  | pending  | not started    |
| `[~]`  | active   | in progress    |
| `[x]`  | done     | completed      |
| `[!]`  | blocked  | cannot proceed |

What a state *triggers* — scheduling, retries, notifications — is up to your
tool. A task may link to a Markdown file (`[text](path/file.md)`); the linked
file's own frontmatter is merged over the board's when you ask for a task's
config.

## Install

```sh
bun add @leonardmeagher2/tasksmd
```

## Task contexts

The easiest way to work with a board: open it, grab a task, and use opaque
operations. No parsing, no file handling.

```ts
import { openBoard, taskContext } from "@leonardmeagher2/tasksmd"

const board = openBoard("/path/to/project") // finds TASKS.md
board.exists()        // true
board.tasks()         // top-level tasks only
board.config()        // parsed frontmatter

const task = board.task("add-a-health-check-endpoint")
task.state()          // "pending"
task.config()         // board config merged with the linked file's config
task.markActive()     // [~]
task.markDone()       // [x]
task.markBlocked()    // [!]
task.markPending()    // [ ]

// Or skip the board when you already know the slug:
taskContext("/path/to/project", "add-a-health-check-endpoint").markDone()
```

Every operation re-reads the file, edits exactly one marker line, and writes it
back — frontmatter, other tasks, and indentation are preserved. Operations
return `false` when the slug is not on the board instead of throwing.

## Pure functions

For full control, the underlying functions are exported too:

```ts
import { parseChecklist, replaceTask } from "@leonardmeagher2/tasksmd"

const board = parseChecklist(markdown)
board.frontmatter  // Record<string, unknown>
board.tasks        // every checkbox line, flat (subtasks included)
board.roots        // top-level tasks with .subtasks attached

replaceTask(markdown, "task-slug", "done") // updated markdown, or undefined
```

## Frontmatter helpers

```ts
import {
  frontmatter,      // YAML frontmatter of any Markdown string -> Record
  mergeFrontmatter, // deep-merge two frontmatter records (override wins)
} from "@leonardmeagher2/tasksmd"
```

tasksmd deliberately imposes no schema on frontmatter. Whatever settings your
tool has, parse and validate them in your tool.

## License

MIT
