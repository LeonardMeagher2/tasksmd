import { describe, expect, test } from "bun:test"
import { stateDir, logFile } from "./state"

describe("stateDir", () => {
  test("returns deterministic path for same directory", () => {
    const a = stateDir("/home/user/project")
    const b = stateDir("/home/user/project")
    expect(a).toBe(b)
  })

  test("returns different paths for different directories", () => {
    const a = stateDir("/home/user/project-a")
    const b = stateDir("/home/user/project-b")
    expect(a).not.toBe(b)
  })

  test("path contains opencode-tasks segment", () => {
    const result = stateDir("/tmp/test-path")
    expect(result).toContain("opencode-tasks")
  })

  test("uses LOCALAPPDATA on win32", () => {
    const original = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local"
    try {
      const result = stateDir("C:\\project")
      expect(result).toStartWith("C:\\Users\\test\\AppData\\Local\\opencode-tasks\\")
    } finally {
      process.env.LOCALAPPDATA = original
    }
  })
})

describe("logFile", () => {
  test("path contains worker.log", () => {
    const result = logFile("/tmp/project")
    expect(result).toContain("worker.log")
  })

  test("path contains opencode-tasks segment", () => {
    const result = logFile("/tmp/project")
    expect(result).toContain("opencode-tasks")
  })
})
