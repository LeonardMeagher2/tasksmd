import { describe, expect, test } from "bun:test"
import { mergeFrontmatter, parseFrontmatter, serializeFrontmatter, stripFrontmatter } from "./frontmatter"

describe("parseFrontmatter", () => {
  test("parses simple frontmatter", () => {
    const content = `---
every: 5 minutes
model: ollama/foo
---`
    expect(parseFrontmatter(content)).toEqual({
      every: "5 minutes",
      model: "ollama/foo",
    })
  })

  test("parses numeric value", () => {
    const content = `---
max_active: 3
---`
    expect(parseFrontmatter(content)).toEqual({ max_active: 3 })
  })

  test("parses boolean values", () => {
    const content = `---
enabled: true
disabled: false
---`
    expect(parseFrontmatter(content)).toEqual({ enabled: true, disabled: false })
  })

  test("parses nested object", () => {
    const content = `---
permission:
  bash: deny
  read: allow
---`
    expect(parseFrontmatter(content)).toEqual({
      permission: { bash: "deny", read: "allow" },
    })
  })

  test("returns empty object when no frontmatter", () => {
    expect(parseFrontmatter("no frontmatter here")).toEqual({})
  })

  test("handles quoted strings", () => {
    const content = `---
title: "hello world"
---`
    expect(parseFrontmatter(content)).toEqual({ title: "hello world" })
  })

  test("ignores comment lines", () => {
    const content = `---
# this is a comment
key: value
---`
    expect(parseFrontmatter(content)).toEqual({ key: "value" })
  })

  test("values with colons are preserved", () => {
    const content = `---
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
---`
    expect(parseFrontmatter(content).model).toBe("ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M")
  })

  test("empty frontmatter returns empty object", () => {
    expect(parseFrontmatter(`---
---`)).toEqual({})
  })

  test("key with empty value", () => {
    const content = `---
key:
---`
    expect(parseFrontmatter(content)).toEqual({ key: null })
  })

  test("quoted keys are unquoted", () => {
    const content = `---
permission:
  bash:
    "*.exe": deny
---`
    expect(parseFrontmatter(content)).toEqual({
      permission: { bash: { "*.exe": "deny" } },
    })
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
    expect(parseFrontmatter(content)).toEqual({
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
    expect(parseFrontmatter(content)).toEqual({
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
    expect(parseFrontmatter(content)).toEqual({ key: "value" })
  })

  test("multiple documents (only first frontmatter)", () => {
    const content = `---
a: 1
---
---
b: 2
---`
    expect(parseFrontmatter(content)).toEqual({ a: 1 })
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

describe("serializeFrontmatter", () => {
  test("round-trips nested values", () => {
    const content = serializeFrontmatter({ every: "5 minutes", permission: { bash: "deny" } })
    expect(parseFrontmatter(content)).toEqual({ every: "5 minutes", permission: { bash: "deny" } })
  })
})

describe("stripFrontmatter", () => {
  test("removes a leading frontmatter block", () => {
    expect(stripFrontmatter("---\nevery: 1 hour\n---\n\n# Goal\n")).toBe("\n# Goal\n")
  })

  test("handles CRLF frontmatter, normalizing to LF like replaceTask", () => {
    expect(stripFrontmatter("---\r\nevery: 1 hour\r\n---\r\n# Goal\r\n")).toBe("# Goal\n")
  })

  test("empty frontmatter block leaves the body", () => {
    expect(stripFrontmatter("---\n---\n# Goal")).toBe("# Goal")
  })

  test("leaves content without frontmatter alone", () => {
    expect(stripFrontmatter("# Goal\nShip it")).toBe("# Goal\nShip it")
  })

  test("leaves unclosed frontmatter alone", () => {
    expect(stripFrontmatter("---\nevery: 1 hour\n# Goal")).toBe("---\nevery: 1 hour\n# Goal")
  })
})
