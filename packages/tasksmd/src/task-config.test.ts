import { describe, expect, test } from "bun:test"
import { frontmatterData, parseEvery, mergeFrontmatter, taskPermissions, permissionRules, modelValue } from "./task-config"

describe("frontmatterData", () => {
  test("parses simple frontmatter", () => {
    const content = `---
every: 5 minutes
model: ollama/foo
---`
    expect(frontmatterData(content)).toEqual({
      every: "5 minutes",
      model: "ollama/foo",
    })
  })

  test("parses numeric value", () => {
    const content = `---
max_active: 3
---`
    expect(frontmatterData(content)).toEqual({ max_active: 3 })
  })

  test("parses boolean values", () => {
    const content = `---
enabled: true
disabled: false
---`
    expect(frontmatterData(content)).toEqual({ enabled: true, disabled: false })
  })

  test("parses nested object", () => {
    const content = `---
permission:
  bash: deny
  read: allow
---`
    expect(frontmatterData(content)).toEqual({
      permission: { bash: "deny", read: "allow" },
    })
  })

  test("returns empty object when no frontmatter", () => {
    expect(frontmatterData("no frontmatter here")).toEqual({})
  })

  test("handles quoted strings", () => {
    const content = `---
title: "hello world"
---`
    expect(frontmatterData(content)).toEqual({ title: "hello world" })
  })

  test("ignores comment lines", () => {
    const content = `---
# this is a comment
key: value
---`
    expect(frontmatterData(content)).toEqual({ key: "value" })
  })
})

describe("parseEvery", () => {
  test("returns 0 for false", () => {
    expect(parseEvery(false)).toBe(0)
  })

  test("returns 0 for 0", () => {
    expect(parseEvery(0)).toBe(0)
  })

  test("returns 0 for '0'", () => {
    expect(parseEvery("0")).toBe(0)
  })

  test("parses duration string", () => {
    const result = parseEvery("5 minutes")
    expect(result).toBe(300)
  })

  test("parses numeric string", () => {
    expect(parseEvery("120")).toBe(120)
  })

  test("returns fallback for null", () => {
    expect(parseEvery(null, 600)).toBe(600)
  })

  test("returns fallback for undefined", () => {
    expect(parseEvery(undefined, 600)).toBe(600)
  })

  test("returns number as-is", () => {
    expect(parseEvery(300)).toBe(300)
  })

  test("returns fallback for cron-like string", () => {
    expect(parseEvery("*/5 * * * *", 600)).toBe(600)
  })

  test("returns 300 fallback by default", () => {
    expect(parseEvery(undefined)).toBe(300)
  })
})

describe("taskPermissions", () => {
  test("extracts valid permissions", () => {
    const data = { permission: { bash: "allow", read: "deny" } }
    expect(taskPermissions(data)).toEqual({ bash: "allow", read: "deny" })
  })

  test("filters invalid values", () => {
    const data = { permission: { bash: "allow", read: "maybe", write: "deny" } }
    expect(taskPermissions(data)).toEqual({ bash: "allow", write: "deny" })
  })

  test("returns empty object when no permission", () => {
    expect(taskPermissions({})).toEqual({})
  })
})

describe("permissionRules", () => {
  test("converts string value to wildcard pattern", () => {
    expect(permissionRules({ bash: "deny" })).toEqual([
      { permission: "bash", pattern: "*", action: "deny" },
    ])
  })

  test("converts object value to per-pattern rules", () => {
    expect(permissionRules({ bash: { "*.exe": "deny", "*": "allow" } })).toEqual([
      { permission: "bash", pattern: "*.exe", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ])
  })
})

describe("modelValue", () => {
  test("parses provider/model string", () => {
    expect(modelValue("ollama/qwen3.5")).toEqual({
      providerID: "ollama",
      modelID: "qwen3.5",
    })
  })

  test("returns undefined when no separator", () => {
    expect(modelValue("qwen3.5")).toBeUndefined()
  })

  test("handles slashes in model ID", () => {
    expect(modelValue("ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M")).toEqual({
      providerID: "ollama",
      modelID: "unsloth/Qwen3.5-9B-GGUF:Q4_K_M",
    })
  })
})

describe("frontmatterData edge cases", () => {
  test("values with colons are preserved", () => {
    const content = `---
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
---`
    const result = frontmatterData(content)
    expect(result.model).toBe("ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M")
  })

  test("empty frontmatter returns empty object", () => {
    const content = `---
---`
    expect(frontmatterData(content)).toEqual({})
  })

  test("key with empty value", () => {
    const content = `---
key:
---`
    expect(frontmatterData(content)).toEqual({ key: {} })
  })

  test("multiple nested blocks", () => {
    const content = `---
permission:
  bash: deny
  read: allow
limits:
  cpu: 2
  memory: 512
---`
    const result = frontmatterData(content)
    expect(result).toEqual({
      permission: { bash: "deny", read: "allow" },
      limits: { cpu: 2, memory: 512 },
    })
  })

  test("mixed inline and nested values", () => {
    const content = `---
every: 5 minutes
permission:
  bash: deny
max_active: 3
---`
    const result = frontmatterData(content)
    expect(result).toEqual({
      every: "5 minutes",
      permission: { bash: "deny" },
      max_active: 3,
    })
  })

  test("ignores non-frontmatter content after closing ---", () => {
    const content = `---
key: value
---
This should not be parsed as YAML: true`
    expect(frontmatterData(content)).toEqual({ key: "value" })
  })

  test("multiple documents (only first frontmatter)", () => {
    const content = `---
a: 1
---
---
b: 2
---`
    const result = frontmatterData(content)
    expect(result).toEqual({ a: 1 })
  })
})

describe("parseEvery edge cases", () => {
  test("empty string returns fallback", () => {
    expect(parseEvery("", 600)).toBe(600)
  })

  test("whitespace string returns fallback", () => {
    expect(parseEvery("   ", 600)).toBe(600)
  })

  test('"0 minutes" returns 0', () => {
    expect(parseEvery("0 minutes")).toBe(0)
  })

  test('"false" string returns fallback (not a duration)', () => {
    expect(parseEvery("false")).toBe(300)
  })

  test("negative number passes through (caller should filter)", () => {
    expect(parseEvery(-1)).toBe(-1)
  })

  test("large value is preserved", () => {
    expect(parseEvery("86400")).toBe(86400)
  })

  test("float string is rounded", () => {
    expect(parseEvery("90.5")).toBe(91)
  })
})

describe("mergeFrontmatter", () => {
  test("override replaces base value", () => {
    expect(mergeFrontmatter({ every: "5 minutes" }, { every: "10 minutes" })).toEqual({ every: "10 minutes" })
  })

  test("override adds new keys", () => {
    expect(mergeFrontmatter({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  test("deep merge nested objects", () => {
    expect(mergeFrontmatter(
      { permission: { bash: "deny" } },
      { permission: { read: "allow" } },
    )).toEqual({ permission: { bash: "deny", read: "allow" } })
  })
})
