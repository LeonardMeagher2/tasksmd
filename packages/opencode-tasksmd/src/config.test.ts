import { describe, expect, test } from "bun:test"
import { parseEvery, taskPermissions, permissionRules, modelValue } from "./config"

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
    expect(parseEvery("5 minutes")).toBe(300)
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

  test("preserves a wildcard permission rule", () => {
    expect(permissionRules({ "*": "deny" })).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
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
