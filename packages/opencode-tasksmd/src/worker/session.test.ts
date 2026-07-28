import { describe, expect, test } from "bun:test"

import type { SessionClient } from "../types"
import { NO_SESSION, prepareAttachedSession, resolveTaskSession, sessionIsBusy } from "./session"

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

describe("sessionIsBusy", () => {
  test("only treats a present non-idle status as busy", () => {
    expect(sessionIsBusy(undefined)).toBe(false)
    expect(sessionIsBusy({ type: "idle" })).toBe(false)
    expect(sessionIsBusy({ type: "working" })).toBe(true)
  })
})

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
