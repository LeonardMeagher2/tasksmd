import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { stateFile, updateTask } from "../state"
import type { PluginClient, SessionClient } from "../types"
import {
  LINKED_TASK_BODY_LIMIT,
  NO_SESSION,
  autoApprovedRules,
  linkedTaskContextBlock,
  parseRuleset,
  pickAgent,
  prepareAttachedSession,
  promptKind,
  resolveTaskSession,
  runTaskBySlug,
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

  test("names matched globs rather than individual changed files", () => {
    const prompt = taskPrompt(task, "recurring", "", ["src/**", "README.md"])
    expect(prompt).toContain("Changes were detected in paths matching these watch patterns:\n- `src/**`\n- `README.md`")
    expect(prompt).toContain("Check the relevant changes as you work.")
    expect(prompt).not.toContain("runs on a schedule")
  })

  test("no matched glob means no watch block", () => {
    expect(taskPrompt(task, "fresh")).not.toContain("watched path matching")
    expect(taskPrompt(task, "resume")).not.toContain("watched path matching")
  })

  test("a resumed task sees the matched glob", () => {
    const prompt = taskPrompt({ ...task, state: "active" }, "resume", "", ["src/**"])
    expect(prompt).toContain("A watched path matching `src/**` changed. Check the relevant changes as you work.")
    expect(prompt).not.toContain("Steps")
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
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
      { permission: "tasks_run", pattern: "*", action: "deny" },
    ])
  })

  test("adds task:deny when *:allow is present but no explicit task", () => {
    expect(sessionPermissionRules({ permission: { "*": "allow" } })).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
      { permission: "tasks_run", pattern: "*", action: "deny" },
    ])
  })

  test("keeps task permissions while enabling only worker status tools", () => {
    expect(sessionPermissionRules({ permission: { "*": "deny" } })).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
      { permission: "tasks_run", pattern: "*", action: "deny" },
    ])
  })

  test("uses explicit task:allow instead of default deny", () => {
    expect(sessionPermissionRules({ permission: { task: "allow" } })).toEqual([
      { permission: "task", pattern: "*", action: "allow" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
      { permission: "tasks_run", pattern: "*", action: "deny" },
    ])
  })

  test("uses explicit task:deny and does not add a second", () => {
    expect(sessionPermissionRules({ permission: { task: "deny" } })).toEqual([
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
      { permission: "tasks_run", pattern: "*", action: "deny" },
    ])
  })

  test("preserves per-agent glob pattern for task", () => {
    expect(sessionPermissionRules({ permission: { task: { explore: "allow" } } })).toEqual([
      { permission: "task", pattern: "explore", action: "allow" },
      { permission: "task_done", pattern: "*", action: "allow" },
      { permission: "task_info", pattern: "*", action: "allow" },
      { permission: "tasks_debug", pattern: "*", action: "deny" },
      { permission: "tasks_start", pattern: "*", action: "deny" },
      { permission: "tasks_stop", pattern: "*", action: "deny" },
      { permission: "tasks_run", pattern: "*", action: "deny" },
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

describe("permission rule precedence", () => {
  // Mirrors opencode's own resolver: evaluate() takes the LAST matching rule.
  function match(input: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
    return new RegExp("^" + escaped + "$", "si").test(input)
  }
  function action(rules: ReturnType<typeof sessionPermissionRules>, permission: string, pattern = "*"): string {
    return rules.findLast((r) => match(permission, r.permission) && match(pattern, r.pattern))?.action ?? "ask"
  }

  test("a narrow deny survives a broad allow listed before it", () => {
    const rules = sessionPermissionRules({ permission: { bash: "deny", "*": "allow" } })
    expect(action(rules, "bash")).toBe("deny")
    expect(action(rules, "edit")).toBe("allow")
  })

  test("a narrow pattern survives a broad pattern on the same permission", () => {
    const rules = sessionPermissionRules({ permission: { bash: { "*": "deny", "git *": "allow" } } })
    expect(action(rules, "bash", "git push")).toBe("allow")
    expect(action(rules, "bash", "rm -rf /")).toBe("deny")
  })

  test("the plugin's own rules cannot be overridden by a board", () => {
    const rules = sessionPermissionRules({ permission: { "*": "allow", tasks_stop: "allow", tasks_run: "allow" } })
    expect(action(rules, "tasks_stop")).toBe("deny")
    expect(action(rules, "tasks_run")).toBe("deny")
    expect(action(rules, "task_done")).toBe("allow")
  })
})

describe("autoApprovedRules", () => {
  test("turns ask into allow and leaves allow and deny alone", () => {
    expect(autoApprovedRules([
      { permission: "external_directory", pattern: "*", action: "ask" },
      { permission: "question", pattern: "*", action: "deny" },
      { permission: "*", pattern: "*", action: "allow" },
    ])).toEqual([
      { permission: "external_directory", pattern: "*", action: "allow" },
      { permission: "question", pattern: "*", action: "deny" },
      { permission: "*", pattern: "*", action: "allow" },
    ])
  })

  test("keeps the base order so narrow rules still win", () => {
    const base = [
      { permission: "read", pattern: "*", action: "allow" as const },
      { permission: "read", pattern: "*.env", action: "ask" as const },
    ]
    expect(autoApprovedRules(base).map((r) => r.pattern)).toEqual(["*", "*.env"])
  })
})

describe("sessionPermissionRules with auto_approve", () => {
  const base = [
    { permission: "*", pattern: "*", action: "allow" as const },
    { permission: "external_directory", pattern: "*", action: "ask" as const },
    { permission: "question", pattern: "*", action: "deny" as const },
  ]

  test("re-issues the base ruleset with asks approved", () => {
    const rules = sessionPermissionRules({ auto_approve: true }, base)
    expect(rules.slice(0, 3)).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "external_directory", pattern: "*", action: "allow" },
      { permission: "question", pattern: "*", action: "deny" },
    ])
  })

  test("ignores the base ruleset when auto_approve is off", () => {
    expect(sessionPermissionRules({}, base)).toEqual(sessionPermissionRules({}))
  })

  test("still denies sub-agents and scheduler tools", () => {
    const rules = sessionPermissionRules({ auto_approve: true }, base)
    expect(rules).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
    expect(rules).toContainEqual({ permission: "tasks_stop", pattern: "*", action: "deny" })
  })

  test("a board deny still beats an approved base ask", () => {
    const rules = sessionPermissionRules({ auto_approve: true, permission: { external_directory: "deny" } }, base)
    expect(rules.findLast((r) => r.permission === "external_directory")?.action).toBe("deny")
  })
})

describe("parseRuleset", () => {
  test("keeps well formed rules", () => {
    expect(parseRuleset([{ permission: "bash", pattern: "*", action: "allow" }])).toEqual([
      { permission: "bash", pattern: "*", action: "allow" },
    ])
  })

  test("drops anything that is not a rule", () => {
    expect(parseRuleset([
      null,
      "nope",
      { permission: "bash" },
      { permission: "bash", pattern: "*", action: "maybe" },
      { permission: 1, pattern: "*", action: "allow" },
    ])).toEqual([])
  })

  test("returns empty for a non-array, so auto_approve degrades to a no-op", () => {
    expect(parseRuleset(undefined)).toEqual([])
    expect(parseRuleset({ bash: "allow" })).toEqual([])
  })
})

describe("pickAgent", () => {
  const agents = [
    { name: "build", mode: "primary", permission: [] },
    { name: "plan", mode: "primary", permission: [] },
    { name: "explore", mode: "subagent", permission: [] },
  ]

  test("uses the named agent when the task sets one", () => {
    expect(pickAgent(agents, "plan")?.name).toBe("plan")
  })

  test("falls back to build when the task names no agent", () => {
    expect(pickAgent(agents, "")?.name).toBe("build")
  })

  test("falls back to the first primary agent when there is no build", () => {
    expect(pickAgent(agents.slice(1), "")?.name).toBe("plan")
  })

  test("returns undefined for an unknown agent", () => {
    expect(pickAgent(agents, "nope")).toBeUndefined()
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

describe("runTaskBySlug", () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) {
      const dir = dirs.pop()!
      rmSync(stateFile(dir), { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function recurringProject(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-run-"))
    dirs.push(dir)
    writeFileSync(path.join(dir, "TASKS.md"), "- [ ] [Hourly review](checks/hourly.md)\n")
    mkdirSync(path.join(dir, "checks"), { recursive: true })
    writeFileSync(path.join(dir, "checks", "hourly.md"), "---\nevery: 1 hour\n---\nreview\n")
    return dir
  }

  function countingClient(): { client: PluginClient; prompts: () => number } {
    let prompts = 0
    return {
      prompts: () => prompts,
      client: {
        tui: { showToast: async () => ({}) },
        app: { agents: async () => ({ data: [] }) },
        session: {
          get: async () => ({}),
          create: async () => ({ data: { id: "ses_1" } }),
          update: async () => ({}),
          status: async () => ({ data: {} }),
          promptAsync: async () => {
            prompts++
            return {}
          },
        },
      },
    }
  }

  test("skips a recurring task that is not due yet", async () => {
    const dir = recurringProject()
    updateTask(dir, "hourly-review", { last_run: new Date().toISOString() })

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(0)
  })

  test("runs a recurring task once it is due", async () => {
    const dir = recurringProject()
    updateTask(dir, "hourly-review", { last_run: new Date(Date.now() - 7200_000).toISOString() })

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(1)
  })

  test("a recurring task with watch also requires a watch trigger", async () => {
    const dir = recurringProject()
    writeFileSync(path.join(dir, "checks", "hourly.md"), "---\nevery: 1 hour\nwatch: src/**\n---\nreview\n")
    updateTask(dir, "hourly-review", { last_run: new Date(Date.now() - 7200_000).toISOString() })

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(0)

    updateTask(dir, "hourly-review", { has_watch_changed: true })
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(1)
  })

  test("runs a recurring task that has never run", async () => {
    const dir = recurringProject()

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client)
    expect(prompts()).toBe(1)
  })

  test("a forced run ignores the recurring due-check", async () => {
    const dir = recurringProject()
    updateTask(dir, "hourly-review", { last_run: new Date().toISOString() })

    const { client, prompts } = countingClient()
    await runTaskBySlug(dir, "hourly-review", client, true)
    expect(prompts()).toBe(1)
  })

  test("does not add trailing blank lines when a missing linked task is blocked", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-run-"))
    dirs.push(dir)
    writeFileSync(path.join(dir, "TASKS.md"), "- [ ] [Missing link](checks/missing.md)\n")

    const { client } = countingClient()
    await expect(runTaskBySlug(dir, "missing-link", client)).rejects.toThrow(
      "Linked task file not found: checks/missing.md",
    )

    const content = readFileSync(path.join(dir, "TASKS.md"), "utf-8")
    expect(content).toBe("- [!] [Missing link](checks/missing.md)\n")
    expect(content.endsWith("\n\n")).toBe(false)
  })
})
