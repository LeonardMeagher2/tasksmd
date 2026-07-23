# OpenCode Tasks

This repo contains two packages for `TASKS.md` task boards.

- `packages/tasksmd` is the Markdown board library.
- `packages/opencode-tasksmd` is the OpenCode plugin that runs tasks in the background.

## Setup

Install dependencies once:

```sh
bun install
```

## Common Commands

```sh
bun test
bun run build
bun run dev
```

`bun run dev` builds the local plugin bundle at `.opencode/plugins/tasks.js` and the worker at `.opencode/tasks/worker.mjs`.

## Releases

```sh
bun run change
bun run version
bun run release
```

`bun run release` attempts every package and reports failures after all publish
commands have run. Additional arguments are passed to each `bun publish` call.

## Package Docs

- `packages/tasksmd/README.md`
- `packages/opencode-tasksmd/README.md`

Use the package READMEs for install and usage details.
