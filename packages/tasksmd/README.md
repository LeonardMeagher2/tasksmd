# tasksmd

`tasksmd` is a small library for reading and changing `TASKS.md` boards.

`TASKS.md` is plain Markdown. It has YAML frontmatter at the top, then a
checklist of tasks below.

This package defines the format. It parses boards, updates task markers carefully, reads frontmatter, and gives you a handle to one task so your code works with tasks, not files.

`tasksmd` defines the format only. It does not give meaning to frontmatter keys or task states. Your tool decides that.

## What It Does

- Parse a board.
- Create a board.
- Add and remove tasks.
- Update one task marker at a time.
- Read board frontmatter.
- Work with tasks through a task handle.

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

Frontmatter is free-form YAML. The keys above are only examples. Tasks are
checkbox lines in one of four states:

| Marker | State    | Meaning        |
| ------ | -------- | -------------- |
| `[ ]`  | pending  | not started    |
| `[~]`  | active   | in progress    |
| `[x]`  | done     | completed      |
| `[!]`  | blocked  | cannot proceed |

What a state triggers, such as scheduling, retries, or notifications, is up to your tool.

A task can link to another Markdown file, for example `[text](path/file.md)`. When you ask for a task's config, the linked file's frontmatter is merged over the board's frontmatter.

## Install

```sh
npm install @leonardmeagher2/tasksmd
```

## Working With A Board

The simplest way to use a board is to open it, pick a task, and use the task methods. You do not need to parse files yourself.

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

const created = openBoard("/path/to/project")
created.create({ frontmatter: { project: "website" } })
created.addTask({ text: "Add a health check endpoint" })
created.addTask({ text: "Write tests", parent: "add-a-health-check-endpoint" })
created.removeTask("write-tests")

// Or skip the board when you already know the slug:
taskContext("/path/to/project", "add-a-health-check-endpoint").markDone()
```

Each operation re-reads the file, changes one marker line, and writes it back.
Frontmatter, other tasks, and indentation stay in place.

A slug is the short ID used to find one task.

Operations return `false` when the slug is not on the board instead of throwing.
Creating an existing board returns `false` unless `overwrite: true` is passed.
Removing a task also removes its subtasks, but never removes a linked Markdown file.

## Advanced

### Low-Level Functions

For full control, the lower-level functions are exported too:

```ts
import { createChecklist, insertTask, parseChecklist, removeTask, replaceTask } from "@leonardmeagher2/tasksmd"

const board = parseChecklist(markdown)
board.frontmatter  // Record<string, unknown>
board.tasks        // every checkbox line, flat (subtasks included)
board.roots        // top-level tasks with .subtasks attached

replaceTask(markdown, "task-slug", "done") // updated markdown, or undefined
createChecklist({ project: "website" }) // new board markdown
insertTask(markdown, { text: "New task" }) // updated markdown, or undefined
removeTask(markdown, "task-slug") // updated markdown, or undefined
```

### Frontmatter Helpers

```ts
import {
  frontmatter,      // YAML frontmatter of any Markdown string -> Record
  mergeFrontmatter, // deep-merge two frontmatter records (override wins)
} from "@leonardmeagher2/tasksmd"
```

## License

MIT
