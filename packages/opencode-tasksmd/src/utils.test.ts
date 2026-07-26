import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { installBundledSkill } from "./utils"

const projectDirs: string[] = []

afterEach(() => {
  while (projectDirs.length) {
    rmSync(projectDirs.pop()!, { recursive: true, force: true })
  }
})

function setupProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tasksmd-utils-"))
  projectDirs.push(dir)
  return dir
}

describe("installBundledSkill", () => {
  test("installs the bundled skill into .opencode/skills on first run", () => {
    const dir = setupProject()
    const target = path.join(dir, ".opencode", "skills", "tasksmd-writing", "SKILL.md")

    installBundledSkill(dir)

    const content = readFileSync(target, "utf-8")
    expect(content).toContain("name: tasksmd-writing")
    expect(content).toContain("TASKS.md")
  })

  test("does not overwrite an existing workspace-customized skill", () => {
    const dir = setupProject()
    const target = path.join(dir, ".opencode", "skills", "tasksmd-writing", "SKILL.md")

    installBundledSkill(dir)
    writeFileSync(target, "custom skill content\n")

    installBundledSkill(dir)

    expect(readFileSync(target, "utf-8")).toBe("custom skill content\n")
  })
})
