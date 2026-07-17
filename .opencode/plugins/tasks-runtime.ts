import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"
import { taskStateDir, taskStateFile } from "./tasks-state"

const yamlModule = "yaml"
const { parse: parseYaml } = await import(yamlModule)

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
}

function extractLinkText(line: string): string {
  const m = line.match(/\[([^\]]+)\]\([^)]+\)/)
  return m ? m[1] : ""
}

function extractLinkPath(line: string): string {
  const m = line.match(/\[[^\]]+\]\(([^)]+)\)/)
  return m ? m[1] : ""
}

function parseModelStr(s: string): { providerID: string; modelID: string } | undefined {
  if (!s) return undefined
  const sep = s.indexOf("/")
  return sep > 0 ? { providerID: s.slice(0, sep), modelID: s.slice(sep + 1) } : undefined
}

function readFrontmatterKey(content: string, key: string): string {
  try {
    const parts = content.split(/^---\s*$/m)
    const value = (parts.length >= 3 ? parseYaml(parts[1]) : {})?.[key]
    return typeof value === "string" || typeof value === "number" ? String(value) : ""
  } catch {
    return ""
  }
}

function readTaskPermissions(data: Record<string, unknown>): Record<string, unknown> {
  try {
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
  } catch {
    return {}
  }
}

function readFrontmatterData(content: string): Record<string, unknown> {
  try {
    const parts = content.split(/^---\s*$/m)
    return (parts.length >= 3 ? parseYaml(parts[1]) : {}) ?? {}
  } catch {
    return {}
  }
}

function mergeFrontmatter(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merge = (left: unknown, right: unknown): unknown => {
    if (
      left && typeof left === "object" && !Array.isArray(left) &&
      right && typeof right === "object" && !Array.isArray(right)
    ) {
      const result = { ...(left as Record<string, unknown>) }
      for (const [key, value] of Object.entries(right)) result[key] = merge(result[key], value)
      return result
    }
    return right
  }
  return merge(base, override) as Record<string, unknown>
}

function mergePermissions(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base }
  for (const [name, value] of Object.entries(override)) {
    const current = merged[name]
    if (current && typeof current === "object" && value && typeof value === "object") {
      merged[name] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) }
    } else {
      merged[name] = value
    }
  }
  return merged
}

function permissionRules(permissions: Record<string, unknown>): Array<Record<string, string>> {
  return Object.entries(permissions).flatMap(([permission, value]) => {
    if (typeof value === "string") return [{ permission, pattern: "*", action: value }]
    if (value && typeof value === "object") {
      return Object.entries(value).map(([pattern, action]) => ({ permission, pattern, action: String(action) }))
    }
    return []
  })
}

function readState(file: string): { pid?: number; session?: string; status?: string } {
  try { return JSON.parse(readFileSync(file, "utf-8")) } catch { return {} }
}

function writeState(file: string, state: Record<string, unknown>): void {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
}

function pendingTasks(content: string): { idx: number; raw: string }[] {
  const result: { idx: number; raw: string }[] = []
  let inBody = false
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "---") { inBody = !inBody; continue }
    if (!inBody) continue
    if (line.match(/^- \[ \]/)) {
      result.push({ idx: i, raw: line.replace(/^- \[ \] /, "") })
    }
  }
  return result
}

export async function tryRunTask(client: unknown, dir: string): Promise<void> {
  const tasksFile = path.join(dir, "TASKS.md")
  if (!existsSync(tasksFile)) return

  const content = readFileSync(tasksFile, "utf-8")
  let taskConfig = readFrontmatterData(content)
  const defaultModel = readFrontmatterKey(content, "model")

  const pending = pendingTasks(content)
  if (pending.length === 0) return

  const task = pending[0]
  const slug = slugify(extractLinkText(task.raw) || task.raw)
  const stateFile = taskStateFile(dir, slug)

  // Check if already running
  if (existsSync(stateFile)) {
    const state = readState(stateFile)
    if (state.status === "running" && state.pid) {
      try { process.kill(state.pid, 0); return } catch { /* stale */ }
    }
  }

  // Resolve prompt and model
  const linkPath = extractLinkPath(task.raw)
  let prompt = task.raw
  let model = defaultModel

  if (linkPath) {
    const taskFile = path.join(dir, linkPath)
    if (existsSync(taskFile)) {
      const tc = readFileSync(taskFile, "utf-8")
      taskConfig = mergeFrontmatter(taskConfig, readFrontmatterData(tc))
      model = typeof taskConfig.model === "string" ? taskConfig.model : defaultModel
      prompt = task.raw
    }
  }
  const taskPermissions = readTaskPermissions(taskConfig)


  // Mark [ ] → [~]
  const lines = content.split("\n")
  lines[task.idx] = lines[task.idx].replace("- [ ]", "- [~]")
  writeFileSync(tasksFile, lines.join("\n"), "utf-8")

  // Write PID to state for crash tracking
  mkdirSync(taskStateDir(dir), { recursive: true })
  writeState(stateFile, { pid: process.pid, status: "running" })

  try {
    const sdk = client as any
    const session = await sdk.session.create({
      body: {
        title: `task:${slug}`,
        permission: permissionRules(taskPermissions),
      },
    })
    const sessionId = session?.id || session?.info?.id || ""

    writeState(stateFile, { pid: process.pid, session: sessionId, status: "running" })

    const parsedModel = parseModelStr(model)
    await sdk.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: prompt }],
        model: parsedModel,
        agent: "task-runner",
      },
    })

    writeState(stateFile, { ...readState(stateFile), status: "success" })
  } catch (e) {
    if (existsSync(stateFile)) {
      writeState(stateFile, { ...readState(stateFile), status: "failed" })
    }
    // Leave [~] — the caller will fall back to the worker, which can retry.
    throw e
  }
}
