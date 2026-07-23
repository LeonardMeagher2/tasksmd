import { describe, expect, test } from "bun:test"

import { prepareAttachedSession, sessionPermissionRules } from "./run"

describe("sessionPermissionRules", () => {
  test("keeps task permissions while enabling only worker status tools", () => {
    expect(sessionPermissionRules({ permission: { "*": "deny" } })).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "tasks_done", pattern: "*", action: "allow" },
      { permission: "tasks_blocked", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
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
