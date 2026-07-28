import { describe, expect, test } from "bun:test"

import { LINKED_TASK_BODY_LIMIT, linkedTaskContextBlock, promptKind, taskPrompt } from "./prompt"

const task = { raw: "- [ ] Do the work", state: "pending" } as any

describe("promptKind", () => {
  test("fresh for a new pending task without a session", () => {
    expect(promptKind(task, "")).toBe("fresh")
  })

  test("active task without a session is treated as fresh", () => {
    expect(promptKind({ ...task, state: "active" }, "")).toBe("fresh")
  })

  test("resume for an active task with an existing session", () => {
    expect(promptKind({ ...task, state: "active" }, "session-1")).toBe("resume")
  })

  test("recurring when a session exists, even after a manual reset", () => {
    expect(promptKind(task, "session-1")).toBe("recurring")
  })

  test("recurring wins over resume for scheduled reruns", () => {
    expect(promptKind({ ...task, state: "active" }, "session-1", true)).toBe("recurring")
  })

  test("scheduled rerun without a session is treated as fresh", () => {
    expect(promptKind(task, "", true)).toBe("fresh")
  })
})

describe("taskPrompt", () => {
  test("fresh prompt has the steps", () => {
    const prompt = taskPrompt(task, "fresh")
    expect(prompt).toContain("Task current status: pending")
    expect(prompt).toContain("Steps")
  })

  test("fresh prompt can include linked task context", () => {
    const prompt = taskPrompt(task, "fresh", "Linked task file: docs/task.md\n\n# Goal")
    expect(prompt).toContain("Linked task context")
    expect(prompt).toContain("docs/task.md")
  })

  test("resume prompt is short but names the tools", () => {
    const prompt = taskPrompt(task, "resume", "Linked task file: docs/task.md")
    expect(prompt).toContain("Task current status: pending")
    expect(prompt).not.toContain("Steps")
    expect(prompt).not.toContain("Linked task context")
    expect(prompt).toContain("task_done")
    expect(prompt).toContain("blocked_reason")
    expect(prompt).toContain("task_info")
  })

  test("recurring prompt keeps the steps and says the task repeats", () => {
    const prompt = taskPrompt(task, "recurring", "Linked task file: docs/task.md")
    expect(prompt).toContain("schedule")
    expect(prompt).toContain("Steps")
    expect(prompt).not.toContain("Linked task context")
    expect(prompt).toContain("task_done")
  })
})

describe("linkedTaskContextBlock", () => {
  test("includes linked file path and body", () => {
    const context = linkedTaskContextBlock("docs/task.md", "# Goal\nShip it")
    expect(context).toContain("Linked task file: docs/task.md")
    expect(context).toContain("# Goal")
  })

  test("truncates long linked content with a marker", () => {
    const context = linkedTaskContextBlock("docs/task.md", "a".repeat(LINKED_TASK_BODY_LIMIT + 20))
    expect(context).toContain("truncated")
  })

  test("does not inject the linked file's frontmatter", () => {
    const context = linkedTaskContextBlock("docs/task.md", "---\nevery: 1 hour\n---\n\n# Goal\nShip it")
    expect(context).toContain("# Goal")
    expect(context).not.toContain("every")
  })

  test("treats a frontmatter-only file as empty", () => {
    const context = linkedTaskContextBlock("docs/task.md", "---\nevery: 1 hour\n---\n")
    expect(context).toContain("(Linked task file is empty)")
  })
})
