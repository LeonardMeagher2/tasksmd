import { describe, expect, test } from "bun:test"
import { uninstallTaskWorker } from "./tasks-scheduler"

describe("uninstallTaskWorker", () => {
  test("returns a message (does not throw) for non-existent scheduler", async () => {
    const result = await uninstallTaskWorker("/tmp/nonexistent", "test-slug")
    expect(typeof result).toBe("string")
  })

  test("empty slug produces directory-only name", async () => {
    const result = await uninstallTaskWorker("/tmp/my-project", "")
    expect(result.toLowerCase()).toContain("my-project")
    const parts = result.match(/my-project[^\s]*/)?.[0]
    expect(parts).toBeDefined()
    expect(parts).toMatch(/my-project$/)
  })

  test("non-empty slug is included in scheduler name", async () => {
    const result = await uninstallTaskWorker("/tmp/my-project", "my-task")
    expect(result.toLowerCase()).toContain("my-task")
  })
})
