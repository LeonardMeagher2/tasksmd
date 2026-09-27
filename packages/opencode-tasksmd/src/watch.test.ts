import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { parseChecklist } from "@leonardmeagher2/tasksmd"
import { parseWatch } from "./config"
import { taskWatches } from "./schedule"
import { readState, stateFile, updateTask } from "./state"
import { logFile } from "./state"
import { startWatcher } from "./watch"
import type { PluginClient } from "./types"
import { findTask } from "./worker/select"

const projectDirs: string[] = []

afterEach(() => {
  while (projectDirs.length) {
    const dir = projectDirs.pop()!
    rmSync(stateFile(dir), { force: true })
    rmSync(logFile(dir), { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

function setupProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-watch-"))
  projectDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

const idleClient = {
  session: { status: async () => ({ data: {} }) },
} as unknown as PluginClient

describe("taskWatches", () => {
  test("reads watch globs from linked task files", () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n- [ ] [One-off](docs/once.md)\n",
      "docs/rebuild.md": "---\nwatch:\n  - src/**\n  - README.md\n---\nrebuild\n",
      "docs/once.md": "notes\n",
    })
    const parsed = parseChecklist("---\n---\n- [ ] [Rebuild](docs/rebuild.md)\n- [ ] [One-off](docs/once.md)\n")
    expect(taskWatches(dir, parsed)).toEqual({ rebuild: parseWatch(["src/**", "README.md"]) })
  })

  test("accepts a single string", () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [ ] [Rebuild](docs/rebuild.md)\n")
    expect(taskWatches(dir, parsed)).toEqual({ rebuild: parseWatch("src/**") })
  })

  test("omits tasks without watch or a linked file", () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n- [ ] No link\n",
      "docs/rebuild.md": "no frontmatter\n",
    })
    const parsed = parseChecklist("- [ ] [Rebuild](docs/rebuild.md)\n- [ ] No link\n")
    expect(taskWatches(dir, parsed)).toEqual({})
  })
})

describe("findTask watch eligibility", () => {
  test("watch task is not due until a watched path changes, regardless of board state", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [ ] [Rebuild](docs/rebuild.md)\n")
    // Pending but unchanged -> not eligible.
    expect(await findTask(dir, parsed, idleClient)).toBeUndefined()

    updateTask(dir, "rebuild", { has_watch_changed: true })
    const selected = await findTask(dir, parsed, idleClient)
    expect(selected?.slug).toBe("rebuild")
  })

  test("done watch task runs when a watched path changes (change overrides state)", async () => {
    const dir = setupProject({
      "TASKS.md": "- [x] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [x] [Rebuild](docs/rebuild.md)\n")
    updateTask(dir, "rebuild", { has_watch_changed: true })
    const selected = await findTask(dir, parsed, idleClient)
    expect(selected?.slug).toBe("rebuild")
  })

  test("every + watch requires both (AND)", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nevery: 60\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [ ] [Rebuild](docs/rebuild.md)\n")

    // Watched change, but the interval has not elapsed -> not due.
    updateTask(dir, "rebuild", { has_watch_changed: true, last_run: new Date().toISOString() })
    expect(await findTask(dir, parsed, idleClient)).toBeUndefined()

    // Interval elapsed (never ran) but no watched change -> not due.
    updateTask(dir, "rebuild", { has_watch_changed: undefined, last_run: undefined })
    expect(await findTask(dir, parsed, idleClient)).toBeUndefined()

    // Both -> due.
    updateTask(dir, "rebuild", { has_watch_changed: true, last_run: undefined })
    const selected = await findTask(dir, parsed, idleClient)
    expect(selected?.slug).toBe("rebuild")
  })

  test("blocked watch task stays ineligible even after a watched change", async () => {
    const dir = setupProject({
      "TASKS.md": "- [!] [Rebuild](docs/rebuild.md)\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [!] [Rebuild](docs/rebuild.md)\n")
    updateTask(dir, "rebuild", { has_watch_changed: true })
    expect(await findTask(dir, parsed, idleClient)).toBeUndefined()
  })

  test("a slug colliding with Object.prototype is not treated as changed", async () => {
    const dir = setupProject({
      "TASKS.md": "- [ ] constructor\n",
      "docs/rebuild.md": "---\nwatch: src/**\n---\nrebuild\n",
    })
    const parsed = parseChecklist("- [ ] constructor\n")
    // "constructor" in {} is true via the prototype chain; the task declares no
    // watch, so it must be eligible by board state like any other task.
    const selected = await findTask(dir, parsed, idleClient)
    expect(selected?.slug).toBe("constructor")
  })
})

describe("startWatcher", () => {
  test("fires debounced once, reporting each matching configured glob", async () => {
    const dir = setupProject({
      "src/a.ts": "a\n",
      "src/b.ts": "b\n",
    })
    let fires = 0
    let reported: string[] = []
    const close = startWatcher(dir, "rebuild", parseWatch(["src/**", "src/a.ts"]), (matchedGlobs) => {
      fires++
      reported = matchedGlobs
    })
    try {
      // Give chokidar a moment to finish its initial scan (ignoreInitial).
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(path.join(dir, "src", "a.ts"), "a2\n")
      writeFileSync(path.join(dir, "src", "b.ts"), "b2\n")
      // Debounce is 5s; wait past it for the single coalesced fire.
      await new Promise((resolve) => setTimeout(resolve, 6000))
      expect(fires).toBe(1)
      expect(reported).toEqual(["src/**", "src/a.ts"])
    } finally {
      close?.()
    }
  }, 15000)

  test("watches absolute and parent-relative paths outside the project root", async () => {
    const dir = setupProject({ "README.md": "hi\n" })
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-shared`)
    projectDirs.push(outside)
    mkdirSync(path.join(outside, "src"), { recursive: true })
    const watchedFile = path.join(outside, "src", "app.ts")
    writeFileSync(watchedFile, "v1\n")

    const relativeGlob = `${path.relative(dir, path.join(outside, "src")).split(path.sep).join("/")}/**`
    const absoluteGlob = path.join(outside, "src", "**")
    const config = parseWatch({ paths: [relativeGlob, absoluteGlob], ignore: [] })
    let fires = 0
    const close = startWatcher(dir, "rebuild", config, () => { fires++ })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(watchedFile, "v2\n")
      await new Promise((resolve) => setTimeout(resolve, 6000))
      expect(fires).toBe(1)
    } finally {
      close?.()
    }
  }, 15000)

  test("does not fire for default-ignored paths", async () => {
    const dir = setupProject({ "README.md": "hi\n", "TASKS.md": "- [ ] task\n" })
    let fires = 0
    const close = startWatcher(dir, "rebuild", parseWatch("**/*"), () => { fires++ })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      for (const excluded of [".git", "node_modules", "dist"]) {
        mkdirSync(path.join(dir, excluded), { recursive: true })
        writeFileSync(path.join(dir, excluded, "output.js"), "output\n")
      }
      writeFileSync(path.join(dir, "TASKS.md"), "- [~] task\n")
      await new Promise((resolve) => setTimeout(resolve, 6000))
      expect(fires).toBe(0)
    } finally {
      close?.()
    }
  }, 15000)

  test("custom ignore list replaces the defaults", async () => {
    const dir = setupProject({ "README.md": "hi\n" })
    let fires = 0
    const config = parseWatch({ paths: ["**/*"], ignore: [] })
    const close = startWatcher(dir, "rebuild", config, () => { fires++ })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      mkdirSync(path.join(dir, "dist"), { recursive: true })
      writeFileSync(path.join(dir, "dist", "bundle.js"), "output\n")
      await new Promise((resolve) => setTimeout(resolve, 6000))
      expect(fires).toBe(1)
    } finally {
      close?.()
    }
  }, 15000)

  test("a bare directory name watches its contents", async () => {
    const dir = setupProject({ "docs/guide.md": "v1\n" })
    let fires = 0
    const close = startWatcher(dir, "rebuild", parseWatch("docs"), () => { fires++ })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(path.join(dir, "docs", "guide.md"), "v2\n")
      await new Promise((resolve) => setTimeout(resolve, 6000))
      expect(fires).toBe(1)
    } finally {
      close?.()
    }
  }, 15000)

  test("a bare directory name created after the watcher starts still fires", async () => {
    const dir = setupProject({ "README.md": "hi\n" })
    let fires = 0
    const close = startWatcher(dir, "rebuild", parseWatch("docs"), () => { fires++ })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      mkdirSync(path.join(dir, "docs"), { recursive: true })
      writeFileSync(path.join(dir, "docs", "guide.md"), "v1\n")
      await new Promise((resolve) => setTimeout(resolve, 6000))
      expect(fires).toBe(1)
    } finally {
      close?.()
    }
  }, 15000)
})
