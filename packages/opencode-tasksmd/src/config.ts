import parseDuration from "parse-duration-ms"

/**
 * Plugin-specific interpretations of TASKS.md frontmatter. The tasksmd core
 * parses frontmatter generically; the meanings below belong to this plugin.
 */

export type PermissionConfig = Record<string, unknown>

/** Parse an `every` value into seconds. `false`/`0` disable; unparseable values fall back. */
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

export type WatchConfig = { paths: string[]; ignore: string[] }

export const DEFAULT_WATCH_IGNORES = [
  "**/.git",
  "**/.git/**",
  "**/node_modules",
  "**/node_modules/**",
  "**/dist",
  "**/dist/**",
  "TASKS.md",
]

function patternList(value: unknown): string[] | undefined {
  const clean = (entry: unknown) => (typeof entry === "string" && entry.trim() ? entry.trim() : "")
  if (typeof value === "string") return [clean(value)].filter(Boolean)
  if (Array.isArray(value)) return value.map(clean).filter(Boolean)
  return undefined
}

/**
 * Parse a `watch` value into path and ignore globs. Legacy string/list forms
 * keep the defaults; object form can replace them with its `ignore` list.
 */
export function parseWatch(value: unknown): WatchConfig {
  const defaults = [...DEFAULT_WATCH_IGNORES]
  if (value === false || value === 0 || value === "0") return { paths: [], ignore: defaults }

  const legacyPaths = patternList(value)
  if (legacyPaths) return { paths: legacyPaths, ignore: defaults }

  if (!value || typeof value !== "object" || Array.isArray(value)) return { paths: [], ignore: defaults }
  const config = value as Record<string, unknown>
  const paths = patternList(config.paths) ?? []
  const ignore = Object.hasOwn(config, "ignore") ? patternList(config.ignore) ?? defaults : defaults
  return { paths, ignore }
}

/**
 * Parse `max_active` into a session limit. `false`/`0` remove the limit, as
 * they do for `every`. Anything else that is not a whole number above zero
 * falls back — a typo must not quietly uncap the board.
 */
export function parseMaxActive(value: unknown, fallback = 1): number {
  if (value === false || value === 0 || value === "0") return Number.POSITIVE_INFINITY
  const limit = Math.trunc(Number(value))
  return Number.isFinite(limit) && limit > 0 ? limit : fallback
}

/** Extract valid OpenCode permission entries (allow/ask/deny) from frontmatter. */
export function taskPermissions(data: Record<string, unknown>): PermissionConfig {
  const permission = data.permission
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return {}
  const valid = (value: unknown) => value === "allow" || value === "ask" || value === "deny"
  const entries = Object.entries(permission).flatMap<[string, unknown]>(([name, value]) => {
    if (valid(value)) return [[name, value]]
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const rules = Object.fromEntries(Object.entries(value).filter(([, action]) => valid(action)))
      return Object.keys(rules).length ? [[name, rules]] : []
    }
    return []
  })
  return Object.fromEntries(entries)
}

/** Add `task: "deny"` when the frontmatter doesn't set an explicit `task` permission. */
export function withDefaultTaskDeny(perms: PermissionConfig): PermissionConfig {
  return "task" in perms ? perms : { ...perms, task: "deny" }
}

/** Convert permission config into an OpenCode permission ruleset. */
export function permissionRules(permissions: PermissionConfig): Array<Record<string, string>> {
  return Object.entries(permissions).flatMap(([permission, value]) => {
    if (typeof value === "string") return [{ permission, pattern: "*", action: value }]
    if (value && typeof value === "object") {
      return Object.entries(value).map(([pattern, action]) => ({ permission, pattern, action: String(action) }))
    }
    return []
  })
}

/** Parse a "provider/model" string into OpenCode's model identifiers. */
export function modelValue(value: string): { providerID: string; modelID: string } | undefined {
  const separator = value.indexOf("/")
  if (separator <= 0) return undefined
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}
