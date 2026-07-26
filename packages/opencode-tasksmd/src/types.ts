/**
 * The OpenCode SDK reports failures in the response envelope instead of
 * throwing, so every call has to be checked for `error`.
 */
export type SessionResult<T> = { data?: T; error?: unknown }

export type SessionStatus = { type?: string; message?: string }

export type SessionRecord = { id?: string; permission?: unknown }

export type PermissionRule = { permission: string; pattern: string; action: "ask" | "allow" | "deny" }

/**
 * An agent as `GET /agent` returns it. `permission` is the agent's fully
 * resolved ruleset, but the SDK's published type for it is out of date, so it
 * stays `unknown` here and is validated at the point of use.
 */
export type AgentRecord = { name?: string; mode?: string; permission?: unknown }

/**
 * The slice of the OpenCode plugin client this plugin uses. Request shapes are
 * left `unknown` so the SDK stays the single source of truth for them; only the
 * responses we read are typed.
 */
export type PluginClient = {
  tui: { showToast: (params: unknown) => Promise<unknown> }
  app: { agents: (params: unknown) => Promise<SessionResult<AgentRecord[]>> }
  session: {
    get: (params: unknown) => Promise<SessionResult<SessionRecord>>
    create: (params: unknown) => Promise<SessionResult<SessionRecord>>
    update: (params: unknown) => Promise<SessionResult<SessionRecord>>
    status: (params: unknown) => Promise<SessionResult<Record<string, SessionStatus>>>
    promptAsync: (params: unknown) => Promise<SessionResult<unknown>>
  }
}

/** Just enough of the client to prepare a session — keeps test doubles small. */
export type SessionClient = { session: Pick<PluginClient["session"], "get" | "create" | "update"> }

export type StatusVariant = "info" | "success" | "warning" | "error"
