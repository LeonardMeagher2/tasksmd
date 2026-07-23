import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { createChecklist, insertTask, parseChecklist, removeTask, replaceTask, slugify } from "./checklist"
import type { ChecklistTask, TaskInput, TaskState } from "./checklist"
import { frontmatter, mergeFrontmatter } from "./frontmatter"

/**
 * Opaque handle to one task on a board. Callers work with slugs and states;
 * they never touch the file or the checklist format themselves.
 */
export type TaskContext = {
  readonly slug: string
  readonly boardPath: string
  /** The freshly parsed task, or undefined when the slug is not on the board. */
  current(): ChecklistTask | undefined
  state(): TaskState | undefined
  /** Board frontmatter merged with the linked task file's frontmatter. */
  config(): Record<string, unknown>
  /** Set the task's marker. Returns false when the slug is not on the board. */
  setState(to: TaskState): boolean
  markActive(): boolean
  markDone(): boolean
  markBlocked(): boolean
  markPending(): boolean
}

export type Board = {
  readonly path: string
  exists(): boolean
  /** Top-level tasks (work items). Subtasks live on their parent's `.subtasks`. */
  tasks(): ChecklistTask[]
  config(): Record<string, unknown>
  task(slug: string): TaskContext
  /** Create the board. Returns false when it already exists. */
  create(options?: { frontmatter?: Record<string, unknown>; overwrite?: boolean }): boolean
  /** Add a task. Returns the created task, or undefined for invalid input. */
  addTask(input: TaskInput): ChecklistTask | undefined
  /** Remove a task and its subtasks. Linked files are left untouched. */
  removeTask(slug: string): boolean
}

function boardPathFrom(from: string): string {
  return from.toLowerCase().endsWith(".md") ? from : path.join(from, "TASKS.md")
}

function readBoard(boardPath: string): string | undefined {
  try {
    return readFileSync(boardPath, "utf-8")
  } catch {
    return undefined
  }
}

export function taskContext(from: string, slug: string): TaskContext {
  const boardPath = boardPathFrom(from)

  function current(): ChecklistTask | undefined {
    const content = readBoard(boardPath)
    if (content === undefined) return undefined
    return parseChecklist(content).tasks.find((t) => t.slug === slug)
  }

  function setState(to: TaskState): boolean {
    const content = readBoard(boardPath)
    if (content === undefined) return false
    const updated = replaceTask(content, slug, to)
    if (updated === undefined) return false
    writeFileSync(boardPath, updated, "utf-8")
    return true
  }

  return {
    slug,
    boardPath,
    current,
    state: () => current()?.state,
    config: () => {
      const boardConfig = frontmatter(readBoard(boardPath) ?? "")
      const task = current()
      if (!task?.link) return boardConfig
      const linked = readBoard(path.join(path.dirname(boardPath), task.link.path))
      if (linked === undefined) return boardConfig
      return mergeFrontmatter(boardConfig, frontmatter(linked))
    },
    setState,
    markActive: () => setState("active"),
    markDone: () => setState("done"),
    markBlocked: () => setState("blocked"),
    markPending: () => setState("pending"),
  }
}

export function openBoard(from: string): Board {
  const boardPath = boardPathFrom(from)
  return {
    path: boardPath,
    exists: () => readBoard(boardPath) !== undefined,
    tasks: () => parseChecklist(readBoard(boardPath) ?? "").roots,
    config: () => frontmatter(readBoard(boardPath) ?? ""),
    task: (slug: string) => taskContext(boardPath, slug),
    create: (options = {}) => {
      if (!options.overwrite && readBoard(boardPath) !== undefined) return false
      writeFileSync(boardPath, createChecklist(options.frontmatter), "utf-8")
      return true
    },
    addTask: (input) => {
      const content = readBoard(boardPath)
      if (content === undefined) return undefined
      const updated = insertTask(content, input)
      if (updated === undefined) return undefined
      writeFileSync(boardPath, updated, "utf-8")
      return parseChecklist(updated).tasks.find((task) => task.slug === slugify(input.text))
    },
    removeTask: (slug) => {
      const content = readBoard(boardPath)
      if (content === undefined) return false
      const updated = removeTask(content, slug)
      if (updated === undefined) return false
      writeFileSync(boardPath, updated, "utf-8")
      return true
    },
  }
}
