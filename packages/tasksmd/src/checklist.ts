import { parseFrontmatter, serializeFrontmatter } from "./frontmatter"

export type TaskState = "pending" | "active" | "done" | "blocked"

export type ChecklistTask = {
  slug: string
  indent: number
  state: TaskState
  text: string
  raw: string
  body: string
  subtasks: ChecklistTask[]
  link?: { text: string; path: string }
  line: number
}

export type Checklist = {
  frontmatter: Record<string, unknown>
  /** Flat list of every checkbox line, including subtasks. */
  tasks: ChecklistTask[]
  /** Top-level tasks only; subtasks reachable via `.subtasks`. */
  roots: ChecklistTask[]
}

export type TaskInput = {
  text: string
  state?: TaskState
  link?: string
  /** Slug of an existing task to use as the parent. */
  parent?: string
}

const STATE_NORMALIZE: Record<string, TaskState> = {
  " ": "pending",
  "~": "active",
  "x": "done",
  "X": "done",
  "✓": "done",
  "!": "blocked",
}

const STATE_MARKER: Record<TaskState, string> = {
  pending: " ",
  active: "~",
  done: "x",
  blocked: "!",
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

function extractLink(raw: string): { text: string; path: string } | undefined {
  const m = raw.match(/\[([^\]]+)\]\(([^)]+)\)/)
  return m ? { text: m[1], path: m[2] } : undefined
}

function parseCheckboxLine(line: string, lineNumber: number): ChecklistTask | undefined {
  const match = line.match(/^(\s*)- \[([^\]]{0,2})\] (.*)$/)
  if (!match) return undefined

  const indent = match[1].length
  const rawChar = match[2]
  const raw = match[3]
  const state = STATE_NORMALIZE[rawChar] ?? "pending"
  const link = extractLink(raw)
  const text = link?.text ?? raw
  const slug = slugify(link?.text ?? raw)
  if (!slug) return undefined

  return { slug, indent, state, text, raw, body: "", subtasks: [], link, line: lineNumber }
}

function buildTree(tasks: ChecklistTask[]): ChecklistTask[] {
  const roots: ChecklistTask[] = []
  const stack: ChecklistTask[] = []

  for (const task of tasks) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= task.indent) {
      stack.pop()
    }
    if (stack.length > 0) {
      stack[stack.length - 1].subtasks.push(task)
    } else {
      roots.push(task)
    }
    stack.push(task)
  }

  return roots
}

export function parseChecklist(content: string): Checklist {
  const lines = content.split(/\r?\n/)

  const matter = parseFrontmatter(content)
  let bodyStart = 0

  if (lines.length > 0 && lines[0].trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---")
    bodyStart = end !== -1 ? end + 1 : 0
  }

  const tasks: ChecklistTask[] = []
  let currentTask: ChecklistTask | undefined

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]
    const task = parseCheckboxLine(line, i)
    if (task) {
      tasks.push(task)
      currentTask = task
    } else if (currentTask && line.trim()) {
      const lineIndent = line.search(/\S/)
      if (lineIndent > currentTask.indent) {
        currentTask.body += (currentTask.body ? "\n" : "") + line.trimEnd()
      }
    }
  }

  const roots = buildTree(tasks)

  return { frontmatter: matter, tasks, roots }
}

export function replaceTask(content: string, slug: string, toState: TaskState): string | undefined {
  const marker = STATE_MARKER[toState]
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    if (parseCheckboxLine(lines[i], i)?.slug === slug) {
      lines[i] = lines[i].replace(/^(\s*- \[)[^\]]{0,2}(\])/, `$1${marker}$2`)
      return lines.join("\n")
    }
  }

  return undefined
}

function taskLine(input: TaskInput, indent: number): string {
  const marker = STATE_MARKER[input.state ?? "pending"]
  const body = input.link ? `[${input.text}](${input.link})` : input.text
  return `${" ".repeat(indent)}- [${marker}] ${body}`
}

/** Create a new board document with optional frontmatter. */
export function createChecklist(values: Record<string, unknown> = {}): string {
  return `${serializeFrontmatter(values)}\n`
}

/** Insert a task, returning undefined for an invalid parent or duplicate slug. */
export function insertTask(content: string, input: TaskInput): string | undefined {
  const slug = slugify(input.text)
  if (!slug) return undefined

  const parsed = parseChecklist(content)
  if (parsed.tasks.some((task) => task.slug === slug)) return undefined

  const lines = content.split(/\r?\n/)
  let insertAt = lines.length
  let indent = 0

  if (input.parent) {
    const parent = parsed.tasks.find((task) => task.slug === input.parent)
    if (!parent) return undefined

    indent = parent.indent + 2
    const descendants = parsed.tasks.filter((task) => task.line > parent.line && task.indent > parent.indent)
    const anchor = descendants.at(-1) ?? parent
    insertAt = anchor.line + 1
    while (insertAt < lines.length && !parseCheckboxLine(lines[insertAt], insertAt)) {
      insertAt++
    }
  } else {
    insertAt = lines.length
  }

  if (parsed.tasks.length === 0) {
    if (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--
  } else {
    while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--
  }

  lines.splice(insertAt, 0, taskLine(input, indent))
  return lines.join("\n")
}

/** Remove a task and its nested subtasks, returning undefined when not found. */
export function removeTask(content: string, slug: string): string | undefined {
  const parsed = parseChecklist(content)
  const task = parsed.tasks.find((candidate) => candidate.slug === slug)
  if (!task) return undefined

  const lines = content.split(/\r?\n/)
  let end = task.line + 1
  while (end < lines.length) {
    const next = parsed.tasks.find((candidate) => candidate.line === end)
    if (next && next.indent <= task.indent) break
    end++
  }

  lines.splice(task.line, end - task.line)
  return lines.join("\n")
}
