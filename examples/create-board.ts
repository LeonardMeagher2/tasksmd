import { mkdirSync } from "node:fs"
import path from "node:path"

import { openBoard } from "../packages/tasksmd/dist/index.js"

const directory = path.join(import.meta.dir, "tasksmd-board")
mkdirSync(directory, { recursive: true })

const board = openBoard(directory)
board.create({
  frontmatter: {
    project: "tasksmd example",
    every: "1 hour",
    max_active: 1,
    permission: { bash: "deny" },
  },
  overwrite: true,
})

board.addTask({ text: "Build the example project" })
board.addTask({ text: "Add a health check endpoint", parent: "build-the-example-project" })
board.addTask({ text: "Write integration tests", parent: "build-the-example-project", state: "active" })
board.addTask({ text: "Rewrite the auth flow", link: "auth-task.md" })
board.addTask({ text: "Document the setup", state: "done" })
