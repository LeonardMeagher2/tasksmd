import { frontmatter } from "./frontmatter"

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

  const matter = frontmatter(content)
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
