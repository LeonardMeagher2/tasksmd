import { stripFrontmatter } from "@leonardmeagher2/tasksmd"
import type { ChecklistTask } from "@leonardmeagher2/tasksmd"

export type PromptKind = "fresh" | "resume" | "recurring"

export const LINKED_TASK_BODY_LIMIT = 6000

// A linked file's frontmatter is config, already merged into the run via
// `loadTaskConfig` — injecting it into prompts is noise the agent can mistake
// for instructions, so it is stripped here.
export function linkedTaskContextBlock(linkPath: string, body: string, limit = LINKED_TASK_BODY_LIMIT): string {
  const trimmed = stripFrontmatter(body).trim()
  if (!trimmed) return `Linked task file: ${linkPath}\n\n(Linked task file is empty)`
  if (trimmed.length <= limit) return `Linked task file: ${linkPath}\n\n${trimmed}`
  return `Linked task file: ${linkPath}\n\n${trimmed.slice(0, limit)}\n\n[Linked task content truncated to ${limit} characters. Read the full linked file before making changes.]`
}

export function taskPrompt(task: ChecklistTask, kind: PromptKind, linkedContext = ""): string {
  if (kind === "resume") {
    return `Task current status: ${task.state}.
Continue the task.
Use the task_info tool to see the task.
When done, use the task_done tool.
If stuck, use the task_done tool with blocked_reason.`
  }

  const intro = kind === "recurring" ? "This task runs on a schedule. You did it before. Do it again now:" : "Do this task:"
  const linkedSection = kind === "fresh" && linkedContext ? `\n\nLinked task context:\n${linkedContext}` : ""

  return `${intro}

Task current status: ${task.state}.

${task.raw}
${linkedSection}

Steps:
1. Read the task. Read every file it links to.
2. Do the work.
3. Check the work.
4. Use the task_done tool.

If you cannot do the task, use the task_done tool with blocked_reason.
To see the task again, use the task_info tool.`
}

/**
 * How to prompt this run.
 * - resume: the task is still active — an earlier run was interrupted.
 * - recurring: the task ran before in this session (schedule or manual reset).
 * - fresh: first run.
 */
export function promptKind(task: ChecklistTask, session: string, recurring = false): PromptKind {
  if (recurring) return session ? "recurring" : "fresh"
  if (task.state === "active") return session ? "resume" : "fresh"
  if (session) return "recurring"
  return "fresh"
}
