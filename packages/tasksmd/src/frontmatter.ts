import deepmerge from "deepmerge"
import { parse as parseYaml } from "yaml"

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
