import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginDir = path.dirname(fileURLToPath(import.meta.url))

const siblingSkill = [
  path.join(pluginDir, "..", "skills", "tasksmd-writing", "SKILL.md"),
].find((candidate) => existsSync(candidate))
export const bundledSkill = siblingSkill

export function installBundledSkill(directory: string): void {
  if (!bundledSkill) return
  const target = path.join(directory, ".opencode", "skills", "tasksmd-writing", "SKILL.md")
  if (existsSync(target)) return
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(bundledSkill, target)
}
