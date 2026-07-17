import deepmerge from "deepmerge"
import { parse as parseYaml } from "yaml"

export type PermissionConfig = Record<string, unknown>

export function frontmatterData(content: string): Record<string, unknown> {
  try {
    const parts = content.split(/^---\s*$/m)
    return (parts.length >= 3 ? parseYaml(parts[1]) : {}) ?? {}
  } catch {
    return {}
  }
}

export function mergeFrontmatter(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  return deepmerge(base, override)
}

export function taskPermissions(data: Record<string, unknown>): PermissionConfig {
  const permission = data.permission
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return {}
  const valid = (value: unknown) => value === "allow" || value === "ask" || value === "deny"
  return Object.fromEntries(Object.entries(permission).flatMap(([name, value]) => {
    if (valid(value)) return [[name, value]]
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const rules = Object.fromEntries(Object.entries(value).filter(([, action]) => valid(action)))
      return Object.keys(rules).length ? [[name, rules]] : []
    }
    return []
  }))
}

export function permissionRules(permissions: PermissionConfig): Array<Record<string, string>> {
  return Object.entries(permissions).flatMap(([permission, value]) => {
    if (typeof value === "string") return [{ permission, pattern: "*", action: value }]
    if (value && typeof value === "object") {
      return Object.entries(value).map(([pattern, action]) => ({ permission, pattern, action: String(action) }))
    }
    return []
  })
}

export function modelValue(value: string): { providerID: string; modelID: string } | undefined {
  const separator = value.indexOf("/")
  if (separator <= 0) return undefined
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}
