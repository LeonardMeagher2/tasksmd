import deepmerge from "deepmerge"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

/**
 * Parse the YAML frontmatter block of a Markdown document.
 * Returns an empty object when there is no frontmatter or it is not a mapping.
 * tasksmd assigns no meaning to the keys — consumers define their own schema.
 */
export function frontmatter(content: string): Record<string, unknown> {
  try {
    const parts = content.split(/^---\s*$/m)
    if (parts.length < 3) return {}
    const data: unknown = parseYaml(parts[1])
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}
    return data as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Deep-merge two frontmatter records; values in `override` win. */
export function mergeFrontmatter(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  return deepmerge(base, override)
}

/**
 * The document body with its leading YAML frontmatter block removed.
 * Returns the content unchanged when there is no frontmatter block, or the
 * block is never closed.
 */
export function stripFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return content
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---")
  if (end === -1) return content
  return lines.slice(end + 1).join("\n")
}

/** Serialize a frontmatter mapping into a complete YAML frontmatter block. */
export function serializeFrontmatter(values: Record<string, unknown> = {}): string {
  if (Object.keys(values).length === 0) return "---\n---\n"
  const yaml = stringifyYaml(values).trimEnd()
  return `---\n${yaml}\n---\n`
}
