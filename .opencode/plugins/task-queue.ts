import { type Plugin, tool } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"

const TASKS_FILE = "TASKS.md"
const TASKS_DIR = ".tasks"

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

async function readTasksFile(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, TASKS_FILE), "utf-8")
  } catch {
    return ""
  }
}

async function writeTasksFile(dir: string, content: string): Promise<void> {
  await writeFile(path.join(dir, TASKS_FILE), content, "utf-8")
}

function countTasks(content: string): { pending: number; active: number; done: number } {
  const lines = content.split("\n")
  let pending = 0, active = 0, done = 0
  for (const line of lines) {
    if (/^- \[ \]/.test(line)) pending++
    else if (/^- \[~\]/.test(line)) active++
    else if (/^- \[x\]/.test(line)) done++
  }
  return { pending, active, done }
}

function listTasks(content: string): { state: string; text: string }[] {
  const tasks: { state: string; text: string }[] = []
  for (const line of content.split("\n")) {
    const m = line.match(/^- \[([ ~x])\](.+)/)
    if (m) {
      tasks.push({ state: m[1] === " " ? "pending" : m[1] === "~" ? "active" : "done", text: m[2].trim() })
    }
  }
  return tasks
}

export const TaskQueuePlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      queue_task: tool({
        description: "Add a task to the project's TASKS.md board. Creates a linked file for large tasks.",
        args: {
          prompt: tool.schema.string().describe("What the task should do"),
          model: tool.schema.optional(tool.schema.string()).describe("Model override (e.g. unsloth/Qwen3.5-9B-GGUF:Q4_K_M)"),
          as_file: tool.schema.optional(tool.schema.boolean()).describe("Create as a linked file in .tasks/ instead of inline"),
          acceptance: tool.schema.optional(tool.schema.string()).describe("Acceptance criteria (only for linked file tasks)"),
        },
        async execute(args, ctx) {
          const dir = ctx.directory || directory
          let content = await readTasksFile(dir)

          if (!content) {
            content = "---\n---\n\n"
          }

          let frontmatterEnd = 0
          const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/)
          if (fmMatch) {
            frontmatterEnd = fmMatch[0].length
          }

          if (args.as_file) {
            const slug = slugify(args.prompt)
            const taskDir = path.join(dir, TASKS_DIR)
            await mkdir(taskDir, { recursive: true })

            let taskContent = "---\n"
            if (args.model) taskContent += `model: ${args.model}\n`
            taskContent += "---\n\n"
            taskContent += args.prompt + "\n"
            if (args.acceptance) {
              taskContent += "\nAcceptance criteria:\n"
              taskContent += args.acceptance
            }

            const taskFile = path.join(taskDir, `${slug}.md`)
            await writeFile(taskFile, taskContent, "utf-8")

            const newLine = `- [ ] [${args.prompt}](${TASKS_DIR}/${slug}.md)\n`
            content = content.slice(0, frontmatterEnd) + content.slice(frontmatterEnd) + newLine
          } else {
            let line = `- [ ] ${args.prompt}`
            if (args.model) line += ` --model ${args.model}`
            line += "\n"
            content = content.slice(0, frontmatterEnd) + content.slice(frontmatterEnd) + line
          }

          await writeTasksFile(dir, content)
          const counts = countTasks(content)
          return `Task added. Board: ${counts.pending} pending, ${counts.active} active, ${counts.done} done.`
        },
      }),

      tasks: tool({
        description: "Show the current state of the task board (TASKS.md). Lists pending, active, and done tasks.",
        args: {},
        async execute(_args, ctx) {
          const dir = ctx.directory || directory
          const content = await readTasksFile(dir)
          if (!content) return "No TASKS.md found."

          const counts = countTasks(content)
          const tasks = listTasks(content)

          let result = `## Task Board\n\n`
          result += `**${counts.pending} pending · ${counts.active} active · ${counts.done} done**\n\n`

          if (tasks.length === 0) {
            result += "No tasks yet."
          } else {
            for (const t of tasks) {
              const icon = t.state === "pending" ? "[ ]" : t.state === "active" ? "[~]" : "[x]"
              result += `- ${icon} ${t.text}\n`
            }
          }

          return result
        },
      }),
    },
  }
}

export default TaskQueuePlugin
