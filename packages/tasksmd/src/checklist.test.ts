import { describe, expect, test } from "bun:test"
import { createChecklist, insertTask, parseChecklist, removeTask, replaceTask, slugify } from "./checklist"

describe("slugify", () => {
  test("lowercases and replaces spaces", () => {
    expect(slugify("Hello World")).toBe("hello-world")
  })

  test("removes special characters", () => {
    expect(slugify("Fix the bug! (urgent)")).toBe("fix-the-bug-urgent")
  })

  test("trims dashes", () => {
    expect(slugify("  hello  ")).toBe("hello")
  })

  test("returns empty for empty input", () => {
    expect(slugify("")).toBe("")
  })
})

describe("parseChecklist", () => {
  test("parses simple checklist", () => {
    const result = parseChecklist("- [ ] Task one\n- [x] Task two")
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]).toMatchObject({ slug: "task-one", state: "pending", text: "Task one" })
    expect(result.tasks[1]).toMatchObject({ slug: "task-two", state: "done", text: "Task two" })
  })

  test("parses frontmatter", () => {
    const content = `---
every: 5 minutes
---

- [ ] Task one`
    const result = parseChecklist(content)
    expect(result.frontmatter).toEqual({ every: "5 minutes" })
    expect(result.tasks).toHaveLength(1)
  })

  test("handles active and blocked states", () => {
    const result = parseChecklist("- [~] In progress\n- [!] Blocked")
    expect(result.tasks[0].state).toBe("active")
    expect(result.tasks[1].state).toBe("blocked")
  })

  test("normalizes done markers", () => {
    const result = parseChecklist("- [X] Done upper\n- [✓] Done check")
    expect(result.tasks[0].state).toBe("done")
    expect(result.tasks[1].state).toBe("done")
  })

  test("handles linked tasks", () => {
    const result = parseChecklist("- [ ] [Test task](tasks/test.md)")
    expect(result.tasks[0].link).toEqual({ text: "Test task", path: "tasks/test.md" })
    expect(result.tasks[0].slug).toBe("test-task")
  })

  test("builds subtree from indentation", () => {
    const result = parseChecklist("- [ ] Parent\n  - [ ] Child\n    - [ ] Grandchild")
    expect(result.tasks).toHaveLength(3)
    expect(result.tasks[0].subtasks).toHaveLength(1)
    expect(result.tasks[0].subtasks[0].subtasks).toHaveLength(1)
    expect(result.tasks[0].subtasks[0].subtasks[0].text).toBe("Grandchild")
  })

  test("roots contains top-level tasks only", () => {
    const result = parseChecklist("- [ ] Parent\n  - [ ] Child\n- [ ] Second")
    expect(result.roots).toHaveLength(2)
    expect(result.roots.map((t) => t.slug)).toEqual(["parent", "second"])
    expect(result.roots[0].subtasks.map((t) => t.slug)).toEqual(["child"])
  })

  test("captures body content after task line", () => {
    const content = `- [ ] Task
  Some body text
  More body`
    const result = parseChecklist(content)
    expect(result.tasks[0].body).toBe("  Some body text\n  More body")
  })
})

describe("replaceTask", () => {
  const board = `---
every: 5 minutes
---

- [ ] Task one
- [ ] Task two`

  test("changes task state", () => {
    const result = replaceTask(board, "task-one", "active")
    expect(result).toContain("- [~] Task one")
  })

  test("preserves other tasks", () => {
    const result = replaceTask(board, "task-one", "active")
    expect(result).toContain("- [ ] Task two")
  })

  test("preserves frontmatter", () => {
    const result = replaceTask(board, "task-one", "active")
    expect(result).toContain("every: 5 minutes")
  })

  test("returns undefined when slug not found", () => {
    expect(replaceTask(board, "nonexistent", "done")).toBeUndefined()
  })

  test("marks as done", () => {
    const result = replaceTask(board, "task-two", "done")
    expect(result).toContain("- [x] Task two")
  })

  test("marks as blocked", () => {
    const result = replaceTask(board, "task-two", "blocked")
    expect(result).toContain("- [!] Task two")
  })

  test("handles linked task references", () => {
    const content = "- [ ] [Task](path/to/file.md)"
    const result = replaceTask(content, "task", "active")
    expect(result).toBe("- [~] [Task](path/to/file.md)")
  })

  test("returns undefined when content is empty", () => {
    expect(replaceTask("", "task", "done")).toBeUndefined()
  })

  test("only replaces first matching task", () => {
    const content = "- [ ] First\n- [ ] First"
    const result = replaceTask(content, "first", "done")
    expect(result).toBe("- [x] First\n- [ ] First")
  })

  test("preserves indentation of subtasks", () => {
    const content = "- [ ] Parent\n  - [ ] Child"
    const result = replaceTask(content, "child", "active")
    expect(result).toBe("- [ ] Parent\n  - [~] Child")
  })
})

describe("board mutations", () => {
  test("creates a board with frontmatter", () => {
    const content = createChecklist({ every: "5 minutes", permission: { bash: "deny" } })
    expect(content).toContain("every: 5 minutes")
    expect(content).toContain("  bash: deny")
    expect(parseChecklist(content).frontmatter).toEqual({
      every: "5 minutes",
      permission: { bash: "deny" },
    })
  })

  test("adds a root task", () => {
    const result = insertTask("---\n---\n\n", { text: "Add the health check", state: "active" })
    expect(result).toContain("- [~] Add the health check")
  })

  test("adds a linked subtask after its parent's subtree", () => {
    const content = "- [ ] Parent\n  - [ ] Existing child\n- [ ] Other"
    const result = insertTask(content, { text: "New child", parent: "parent", link: "new.md" })
    expect(result).toBe("- [ ] Parent\n  - [ ] Existing child\n  - [ ] [New child](new.md)\n- [ ] Other")
  })

  test("rejects duplicate and missing parent slugs", () => {
    const content = "- [ ] Existing"
    expect(insertTask(content, { text: "Existing" })).toBeUndefined()
    expect(insertTask(content, { text: "Child", parent: "missing" })).toBeUndefined()
  })

  test("removes a task and its subtasks without removing the next root", () => {
    const content = "- [ ] Parent\n  Details\n  - [ ] Child\n- [ ] Keep"
    expect(removeTask(content, "parent")).toBe("- [ ] Keep")
  })

  test("returns undefined when removing a missing task", () => {
    expect(removeTask("- [ ] Existing", "missing")).toBeUndefined()
  })
})

describe("slugify edge cases", () => {
  test("handles unicode characters", () => {
    expect(slugify("café")).toBe("caf")
  })

  test("collapses multiple dashes", () => {
    expect(slugify("a  b")).toBe("a-b")
  })

  test("handles only special characters", () => {
    expect(slugify("!!!")).toBe("")
  })

  test("handles mixed case", () => {
    expect(slugify("HelloWorld")).toBe("helloworld")
  })
})

describe("parseChecklist edge cases", () => {
  test("empty content", () => {
    const result = parseChecklist("")
    expect(result.tasks).toHaveLength(0)
    expect(result.frontmatter).toEqual({})
  })

  test("only frontmatter no tasks", () => {
    const content = `---
every: 5 minutes
---`
    const result = parseChecklist(content)
    expect(result.tasks).toHaveLength(0)
    expect(result.frontmatter).toEqual({ every: "5 minutes" })
  })

  test("whitespace-only lines are ignored", () => {
    const result = parseChecklist("- [ ] Task\n  \n- [x] Done")
    expect(result.tasks).toHaveLength(2)
  })

  test("body lines less indented than task are not captured", () => {
    const content = "- [ ] Task\nNot body (less indent)"
    const result = parseChecklist(content)
    expect(result.tasks[0].body).toBe("")
  })

  test("multiple tasks with body content", () => {
    const content = `- [ ] First
  Body one
- [ ] Second
  Body two`
    const result = parseChecklist(content)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0].body).toContain("Body one")
    expect(result.tasks[1].body).toContain("Body two")
  })
})
