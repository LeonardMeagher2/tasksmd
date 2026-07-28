import { describe, expect, test } from "bun:test"

import { autoApprovedRules, parseRuleset, pickAgent, sessionPermissionRules } from "./permissions"

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
