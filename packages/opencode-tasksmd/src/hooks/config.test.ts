import { describe, expect, test } from "bun:test"
import { createConfigHook } from "./config"

describe("createConfigHook", () => {
  test("enables task tools only for worker-launched sessions", () => {
    const previous = process.env.OPENCODE_TASKS_SLUG
    const hook = createConfigHook()

    try {
      delete process.env.OPENCODE_TASKS_SLUG

      const noWorkerConfig: Record<string, unknown> = {}
      hook.config(noWorkerConfig)
      expect(noWorkerConfig).toEqual({ tools: { task_done: false, task_blocked: false, task_info: false } })

      process.env.OPENCODE_TASKS_SLUG = "example-task"
      const workerConfig: Record<string, unknown> = {}
      hook.config(workerConfig)
      expect(workerConfig).toEqual({ tools: { task_done: true, task_blocked: true, task_info: true } })
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_TASKS_SLUG
      } else {
        process.env.OPENCODE_TASKS_SLUG = previous
      }
    }
  })
})
