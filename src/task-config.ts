import deepmerge from "deepmerge"
import parseDuration from "parse-duration-ms"

export type PermissionConfig = Record<string, unknown>

function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === "true" || trimmed === "yes") return true
  if (trimmed === "false" || trimmed === "no") return false
  if (trimmed === "null" || trimmed === "~") return null
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  const asNumber = Number(trimmed)
  if (Number.isFinite(asNumber)) return asNumber
  return trimmed
}

function parseYamlLines(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const stack: { obj: Record<string, unknown>; indent: number }[] = [{ obj: result, indent: -1 }]

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const indent = line.length - line.trimStart().length
    const colonIndex = trimmed.indexOf(":")
    if (colonIndex === -1) continue

    const key = trimmed.slice(0, colonIndex).trim()
    const value = trimmed.slice(colonIndex + 1).trim()

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const current = stack[stack.length - 1]
    if (value === "") {
      const nested: Record<string, unknown> = {}
      current.obj[key] = nested
      stack.push({ obj: nested, indent })
    } else {
      current.obj[key] = parseYamlValue(value)
    }
  }

  return result
}

export function frontmatterData(content: string): Record<string, unknown> {
  try {
    const parts = content.split(/^---\s*$/m)
    if (parts.length < 3) return {}
    const lines = parts[1].split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"))
    return parseYamlLines(lines)
  } catch {
    return {}
  }
}

export function parseEvery(value: unknown, fallback = 300): number {
  if (value === false || value === 0 || value === "0") return 0
  if (value === null || value === undefined) return fallback
  if (typeof value === "number") return Math.round(value)
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  if (/[*]/.test(trimmed)) return fallback
  const ms = parseDuration(trimmed)
  if (ms !== undefined) return Math.round(ms / 1000)
  const asNumber = Number(trimmed)
  return Number.isFinite(asNumber) ? Math.round(asNumber) : fallback
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
