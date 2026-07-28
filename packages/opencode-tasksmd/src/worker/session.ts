import { modelValue } from "../config"
import { addTaskSession } from "../state"
import type { PermissionRule, PluginClient, SessionClient, SessionResult, SessionStatus } from "../types"
import { log } from "./common"
import { agentRuleset, ruleKey, sessionPermissionRules } from "./permissions"

/** A `NotFoundError` from the session API means the stored session is gone. */
function sessionMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const details = error as Record<string, unknown>
  const name = typeof details.name === "string" ? details.name.toLowerCase() : ""
  const code = typeof details.code === "string" ? details.code.toLowerCase() : ""
  return name.includes("notfound") || code === "not_found"
}

/** A stored session checked against the runtime, plus the rules it already carries. */
export type ResolvedSession = { id: string; permission: PermissionRule[] }

export const NO_SESSION: ResolvedSession = { id: "", permission: [] }

/**
 * Look up a stored session once per run. An id that no longer resolves is
 * dropped so the run starts fresh instead of resuming a session that is gone.
 */
export async function resolveTaskSession(
  client: SessionClient,
  directory: string,
  sessionID: string,
): Promise<ResolvedSession> {
  if (!sessionID) return NO_SESSION
  const existing = await client.session.get({ path: { id: sessionID }, query: { directory } })
  if (existing.error) {
    if (sessionMissing(existing.error)) return NO_SESSION
    throw new Error(`Failed to load task session: ${JSON.stringify(existing.error)}`)
  }
  const current = existing.data?.permission
  return { id: sessionID, permission: Array.isArray(current) ? (current as PermissionRule[]) : [] }
}

export function sessionStatuses(
  client: PluginClient,
  directory: string,
): Promise<SessionResult<Record<string, SessionStatus>>> {
  return client.session.status({ query: { directory } })
}

export async function prepareAttachedSession(
  client: SessionClient,
  directory: string,
  session: ResolvedSession,
  title: string,
  permission: PermissionRule[],
): Promise<string> {
  if (session.id) {
    const currentRules = new Set(session.permission.map(ruleKey))
    const missing = permission.filter((rule) => !currentRules.has(ruleKey(rule)))
    if (missing.length > 0) {
      const updated = await client.session.update({
        path: { id: session.id },
        query: { directory },
        body: { permission: [...session.permission, ...missing] },
      })
      if (updated?.error) throw new Error(`Failed to apply task permissions: ${JSON.stringify(updated.error)}`)
    }
    return session.id
  }

  const created = await client.session.create({
    query: { directory },
    body: {
      title,
      ...(permission.length > 0 ? { permission } : {}),
    },
  })
  if (created?.error) throw new Error(`Failed to create task session: ${JSON.stringify(created.error)}`)
  return created.data?.id ?? ""
}

export function sessionIsBusy(status: SessionStatus | undefined): boolean {
  return Boolean(status && status.type !== "idle")
}

export async function runAttached(
  client: PluginClient,
  projectRoot: string,
  sessionDir: string,
  slug: string,
  session: ResolvedSession,
  model: string,
  agent: string,
  prompt: string,
  taskConfig: Record<string, unknown>,
): Promise<{ session: string; skipped: boolean }> {
  let baseRuleset: PermissionRule[] = []
  if (taskConfig.auto_approve) {
    try {
      baseRuleset = await agentRuleset(client, sessionDir, agent)
    } catch (error) {
      // Better to run and let OpenCode ask than to fail the task outright.
      log(projectRoot, `task=${slug} auto_approve=unavailable reason=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const rules = sessionPermissionRules(taskConfig, baseRuleset)
  const id = await prepareAttachedSession(client, sessionDir, session, `task:${slug}`, rules)
  if (!id) throw new Error("OpenCode did not return a session ID")

  // Persist session ownership immediately so retries reuse the same session
  // even if status/prompt calls fail afterward.
  addTaskSession(projectRoot, slug, id)

  // Busy-check only applies when reusing an existing session. A newly created
  // session is by definition ours to prompt now, and skipping status avoids
  // creating empty sessions when status lookups transiently fail.
  if (id === session.id) {
    const statuses = await sessionStatuses(client, sessionDir)
    const status = statuses.data?.[id]
    if (status?.type === "retry") throw new Error(`session retry failed: ${status.message}`)
    if (sessionIsBusy(status)) {
      log(projectRoot, `task=${slug} session=${id} status=${status?.type} action=skip`)
      return { session: id, skipped: true }
    }
  }

  // The runtime continues the turn after promptAsync returns.
  const sent = await client.session.promptAsync({
    path: { id },
    query: { directory: sessionDir },
    body: {
      agent: agent || undefined,
      model: modelValue(model),
      parts: [{ type: "text", text: prompt }],
    },
  })
  if (sent.error) throw new Error(JSON.stringify(sent.error))
  return { session: id, skipped: false }
}
