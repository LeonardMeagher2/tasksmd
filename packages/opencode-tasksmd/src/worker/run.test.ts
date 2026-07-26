import { describe, expect, test } from "bun:test"

import type { SessionClient } from "../types"
import {
  LINKED_TASK_BODY_LIMIT,
  NO_SESSION,
  linkedTaskContextBlock,
  prepareAttachedSession,
  promptKind,
  resolveTaskSession,
  sessionIsBusy,
  sessionPermissionRules,
  taskPrompt,
} from "./run"

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
    expect(prompt).toContain("task_blocked")
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
})

describe("sessionIsBusy", () => {
  test("only treats a present non-idle status as busy", () => {
    expect(sessionIsBusy(undefined)).toBe(false)
    expect(sessionIsBusy({ type: "idle" })).toBe(false)
    expect(sessionIsBusy({ type: "working" })).toBe(true)
  })
})

describe("sessionPermissionRules", () => {
  test("adds default task:deny when no task key is present", () => {
    expect(sessionPermissionRules({})).toEqual([
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_blocked", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
    ])
  })

  test("adds task:deny when *:allow is present but no explicit task", () => {
    expect(sessionPermissionRules({ permission: { "*": "allow" } })).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_blocked", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
    ])
  })

  test("keeps task permissions while enabling only worker status tools", () => {
    expect(sessionPermissionRules({ permission: { "*": "deny" } })).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_blocked", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
    ])
  })

  test("uses explicit task:allow instead of default deny", () => {
    expect(sessionPermissionRules({ permission: { task: "allow" } })).toEqual([
      { permission: "task", pattern: "*", action: "allow" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_blocked", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
    ])
  })

  test("uses explicit task:deny and does not add a second", () => {
    expect(sessionPermissionRules({ permission: { task: "deny" } })).toEqual([
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_blocked", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
    ])
  })

  test("preserves per-agent glob pattern for task", () => {
    expect(sessionPermissionRules({ permission: { task: { explore: "allow" } } })).toEqual([
      { permission: "task", pattern: "explore", action: "allow" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_blocked", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
    ])
  })
})

function sessionClient(overrides: Partial<SessionClient["session"]> = {}): SessionClient {
  return {
    session: {
      get: async () => {
        throw new Error("get should not be called")
      },
      update: async () => {
        throw new Error("update should not be called")
      },
      create: async () => {
        throw new Error("create should not be called")
      },
      ...overrides,
    },
  }
}

describe("resolveTaskSession", () => {
  test("returns no session for an empty id without calling the API", async () => {
    expect(await resolveTaskSession(sessionClient(), "/proj", "")).toEqual(NO_SESSION)
  })

  test("returns the id and the rules the session already carries", async () => {
    const permission = [{ permission: "read", pattern: "*", action: "allow" as const }]
    const client = sessionClient({ get: async () => ({ data: { id: "session-1", permission } }) })

    expect(await resolveTaskSession(client, "/proj", "session-1")).toEqual({ id: "session-1", permission })
  })

  test("drops a session the runtime no longer knows", async () => {
    const client = sessionClient({ get: async () => ({ error: { name: "NotFoundError", message: "session not found" } }) })

    expect(await resolveTaskSession(client, "/proj", "old-session")).toEqual(NO_SESSION)
  })

  test("throws when the lookup fails for a reason other than a missing session", async () => {
    const client = sessionClient({ get: async () => ({ error: { name: "UnknownError", message: "backend unavailable" } }) })

    await expect(resolveTaskSession(client, "/proj", "session-1")).rejects.toThrow("Failed to load task session")
  })
})

describe("prepareAttachedSession", () => {
  test("creates a new session with permission rules", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const client = sessionClient({
      create: async (input: unknown) => {
        calls.push({ method: "create", input })
        return { data: { id: "new-session" } }
      },
    })

    const permission = [{ permission: "*", pattern: "*", action: "deny" as const }]
    const id = await prepareAttachedSession(client, "/proj", NO_SESSION, "task:example", permission)

    expect(id).toBe("new-session")
    expect(calls).toEqual([
      {
        method: "create",
        input: {
          query: { directory: "/proj" },
          body: {
            title: "task:example",
            permission,
          },
        },
      },
    ])
  })

  test("updates an existing session when it is missing task rules", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const client = sessionClient({
      update: async (input: unknown) => {
        calls.push({ method: "update", input })
        return {}
      },
    })

    const existing = [{ permission: "read", pattern: "*", action: "allow" as const }]
    const permission = [{ permission: "*", pattern: "*", action: "deny" as const }]
    const id = await prepareAttachedSession(
      client,
      "/proj",
      { id: "session-1", permission: existing },
      "task:example",
      permission,
    )

    expect(id).toBe("session-1")
    expect(calls).toEqual([
      {
        method: "update",
        input: {
          path: { id: "session-1" },
          query: { directory: "/proj" },
          body: { permission: [...existing, ...permission] },
        },
      },
    ])
  })

  test("does not update when the session already has the task rules", async () => {
    const permission = [{ permission: "*", pattern: "*", action: "deny" as const }]
    const id = await prepareAttachedSession(
      sessionClient(),
      "/proj",
      { id: "session-1", permission },
      "task:example",
      permission,
    )

    expect(id).toBe("session-1")
  })

  test("throws when applying permissions fails", async () => {
    const client = sessionClient({ update: async () => ({ error: { name: "UnknownError" } }) })

    await expect(
      prepareAttachedSession(client, "/proj", { id: "session-1", permission: [] }, "task:example", [
        { permission: "*", pattern: "*", action: "deny" },
      ]),
    ).rejects.toThrow("Failed to apply task permissions")
  })

  test("throws when creating a session fails", async () => {
    const client = sessionClient({ create: async () => ({ error: { name: "UnknownError" } }) })

    await expect(prepareAttachedSession(client, "/proj", NO_SESSION, "task:example", [])).rejects.toThrow(
      "Failed to create task session",
    )
  })
})
