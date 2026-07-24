import { describe, expect, test } from "bun:test"

import { extractSessionId, prepareAttachedSession, promptKind, sessionIsBusy, sessionPermissionRules, taskPrompt } from "./run"

const task = { raw: "- [ ] Do the work", state: "pending" } as any

describe("promptKind", () => {
  test("fresh for a new pending task without a session", () => {
    expect(promptKind(task, "")).toBe("fresh")
  })

  test("resume for an active task", () => {
    expect(promptKind({ ...task, state: "active" }, "")).toBe("resume")
    expect(promptKind({ ...task, state: "active" }, "session-1")).toBe("resume")
  })

  test("recurring when a session exists, even after a manual reset", () => {
    expect(promptKind(task, "session-1")).toBe("recurring")
  })

  test("recurring wins over resume for scheduled reruns", () => {
    expect(promptKind({ ...task, state: "active" }, "session-1", true)).toBe("recurring")
  })
})

describe("taskPrompt", () => {
  test("fresh prompt has the steps", () => {
    const prompt = taskPrompt(task, "fresh")
    expect(prompt).toContain("Task current status: pending")
    expect(prompt).toContain("Steps")
  })

  test("resume prompt is short but names the tools", () => {
    const prompt = taskPrompt(task, "resume")
    expect(prompt).toContain("Task current status: pending")
    expect(prompt).not.toContain("Steps")
    expect(prompt).toContain("task_done")
    expect(prompt).toContain("task_blocked")
    expect(prompt).toContain("task_info")
  })

  test("recurring prompt keeps the steps and says the task repeats", () => {
    const prompt = taskPrompt(task, "recurring")
    expect(prompt).toContain("schedule")
    expect(prompt).toContain("Steps")
    expect(prompt).toContain("task_done")
  })
})

describe("extractSessionId", () => {
  test("reads sessionID from a JSON event line", () => {
    expect(extractSessionId(`{"type":"start","sessionID":"ses_123"}`)).toBe("ses_123")
  })

  test("finds a nested sessionID", () => {
    expect(extractSessionId(`{"type":"part","part":{"sessionID":"ses_456"}}`)).toBe("ses_456")
  })

  test("skips stderr noise and broken lines", () => {
    const text = `warning: something\n{not json\n{"type":"start","sessionID":"ses_789"}`
    expect(extractSessionId(text)).toBe("ses_789")
  })

  test("ignores sessionID mentioned in plain text", () => {
    expect(extractSessionId(`error: "sessionID":"ses_fake" not found`)).toBe("")
  })

  test("returns empty when there is no sessionID", () => {
    expect(extractSessionId(`{"type":"done"}\nplain text`)).toBe("")
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
  test("keeps task permissions while enabling only worker status tools", () => {
    expect(sessionPermissionRules({ permission: { "*": "deny" } })).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_blocked", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
    ])
  })
})

describe("prepareAttachedSession", () => {
  test("creates a new session with permission rules", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const client = {
      session: {
        get: async () => {
          throw new Error("get should not be called")
        },
        update: async (input: unknown) => {
          calls.push({ method: "update", input })
          return {}
        },
        create: async (input: unknown) => {
          calls.push({ method: "create", input })
          return { data: { id: "new-session" } }
        },
      },
    }

    const permission = [{ permission: "*", pattern: "*", action: "deny" }]
    const id = await prepareAttachedSession(client, "/proj", "", "task:example", permission)

    expect(id).toBe("new-session")
    expect(calls).toEqual([
      {
        method: "create",
        input: {
          body: {
            title: "task:example",
            permission,
          },
          query: { directory: "/proj" },
        },
      },
    ])
  })

  test("updates an existing session when it is missing task rules", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const client = {
      session: {
        get: async () => ({ data: { id: "session-1", permission: [{ permission: "read", pattern: "*", action: "allow" }] } }),
        update: async (input: unknown) => {
          calls.push({ method: "update", input })
          return {}
        },
        create: async () => {
          throw new Error("create should not be called")
        },
      },
    }

    const permission = [{ permission: "*", pattern: "*", action: "deny" }]
    const id = await prepareAttachedSession(client, "/proj", "session-1", "task:example", permission)

    expect(id).toBe("session-1")
    expect(calls).toEqual([
      {
        method: "update",
        input: {
          path: { id: "session-1" },
          query: { directory: "/proj" },
          body: { permission },
        },
      },
    ])
  })

  test("does not update when the session already has the task rules", async () => {
    const client = {
      session: {
        get: async () => ({
          data: {
            id: "session-1",
            permission: [{ permission: "*", pattern: "*", action: "deny" }],
          },
        }),
        update: async () => {
          throw new Error("update should not be called")
        },
        create: async () => {
          throw new Error("create should not be called")
        },
      },
    }

    const permission = [{ permission: "*", pattern: "*", action: "deny" }]
    const id = await prepareAttachedSession(client, "/proj", "session-1", "task:example", permission)

    expect(id).toBe("session-1")
  })
})
