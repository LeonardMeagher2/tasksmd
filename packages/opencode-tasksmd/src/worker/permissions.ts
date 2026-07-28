import { permissionRules, taskPermissions, withDefaultTaskDeny } from "../config"
import type { AgentRecord, PermissionRule, PluginClient } from "../types"

/** The agent whose permissions a task will inherit. */
export function pickAgent(agents: AgentRecord[], preferred: string): AgentRecord | undefined {
  if (preferred) return agents.find((agent) => agent.name === preferred)
  return agents.find((agent) => agent.name === "build") ?? agents.find((agent) => agent.mode === "primary")
}

/**
 * The ruleset a task session starts from: OpenCode's defaults merged with the
 * agent's own rules and the user's config. Only needed for `auto_approve`; an
 * empty result makes it a no-op rather than a failure.
 */
export async function agentRuleset(
  client: PluginClient,
  directory: string,
  preferred: string,
): Promise<PermissionRule[]> {
  const response = await client.app.agents({ query: { directory } })
  if (response.error) throw new Error(JSON.stringify(response.error))
  const agent = pickAgent(response.data ?? [], preferred)
  if (!agent) throw new Error(`agent not found: ${preferred || "(default)"}`)
  return parseRuleset(agent.permission)
}

export function ruleKey(rule: PermissionRule): string {
  return `${rule.permission} ${rule.pattern} ${rule.action}`
}

/**
 * OpenCode resolves a permission with `findLast`, so the last matching rule
 * wins. Ordering rules least specific first makes a narrow rule beat a broad
 * one regardless of the order they appear in frontmatter — without this,
 * `{ bash: deny, "*": allow }` would silently lose the deny.
 */
function bySpecificity(a: PermissionRule, b: PermissionRule): number {
  const score = (rule: PermissionRule) => (rule.permission === "*" ? 0 : 2) + (rule.pattern === "*" ? 0 : 1)
  return score(a) - score(b)
}

const ACTIONS = new Set(["ask", "allow", "deny"])

/** Read a ruleset off an API response without trusting its shape. */
export function parseRuleset(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const rule = entry as Record<string, unknown>
    if (typeof rule.permission !== "string") return []
    if (typeof rule.pattern !== "string") return []
    if (typeof rule.action !== "string" || !ACTIONS.has(rule.action)) return []
    return [{ permission: rule.permission, pattern: rule.pattern, action: rule.action as PermissionRule["action"] }]
  })
}

/**
 * `auto_approve` turns every question into a yes while leaving refusals alone.
 * OpenCode has already resolved its defaults, the agent and the user's config
 * into one ruleset, so re-issuing that ruleset with `ask` flipped to `allow` is
 * enough — order is preserved, and `deny` rules come back untouched.
 */
export function autoApprovedRules(base: PermissionRule[]): PermissionRule[] {
  return base.map((rule) => (rule.action === "ask" ? { ...rule, action: "allow" as const } : rule))
}

export function sessionPermissionRules(
  taskConfig: Record<string, unknown>,
  baseRuleset: PermissionRule[] = [],
): PermissionRule[] {
  const configured = permissionRules(withDefaultTaskDeny(taskPermissions(taskConfig))) as PermissionRule[]
  const autoApprove = Boolean(taskConfig.auto_approve)
  return [
    // Least specific first: the re-issued base ruleset is the floor, board and
    // task rules refine it, and the plugin's own rules stay last so a board
    // cannot grant a task session control over the scheduler or hide its own
    // status tools.
    ...(autoApprove ? autoApprovedRules(baseRuleset) : []),
    ...[...configured].sort(bySpecificity),
    { permission: "task_done", pattern: "*", action: "allow" },
    { permission: "task_info", pattern: "*", action: "allow" },
    { permission: "tasks_debug", pattern: "*", action: "deny" },
    { permission: "tasks_start", pattern: "*", action: "deny" },
    { permission: "tasks_stop", pattern: "*", action: "deny" },
    { permission: "tasks_run", pattern: "*", action: "deny" },
  ]
}
