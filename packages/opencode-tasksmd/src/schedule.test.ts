import { describe, expect, test } from "bun:test"
import { scheduleDue } from "./schedule"

const NOW = Date.parse("2026-01-01T12:00:00.000Z")

function at(minutesAgo: number): string {
  return new Date(NOW - minutesAgo * 60_000).toISOString()
}

describe("scheduleDue", () => {
  test("a task that never ran is due", () => {
    expect(scheduleDue(undefined, 3600, NOW)).toBe(true)
  })

  test("an unreadable timestamp is treated as never run", () => {
    expect(scheduleDue("soon", 3600, NOW)).toBe(true)
  })

  test("not due before the interval has passed", () => {
    expect(scheduleDue(at(59), 3600, NOW)).toBe(false)
  })

  test("due once the interval has passed", () => {
    expect(scheduleDue(at(60), 3600, NOW)).toBe(true)
  })

  test("a missed interval is still due, not skipped", () => {
    expect(scheduleDue(at(600), 3600, NOW)).toBe(true)
  })

  test("no interval is never due", () => {
    expect(scheduleDue(undefined, 0, NOW)).toBe(false)
  })
})
