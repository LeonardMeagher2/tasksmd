import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { frontmatterData, mergeFrontmatter, modelValue, permissionRules, taskPermissions } from "./task-config"
import { taskStateDir, taskStateFile } from "./tasks-state"

const projectRoot = path.resolve(process.cwd())
const tasksFile = path.join(projectRoot, "TASKS.md")
const stateDir = taskStateDir(projectRoot)

type TaskState = "pending" | "active" | "done" | "blocked"
type RuntimeState = { pid?: number; session?: string; status?: string; exit_code?: number; output?: string }

function log(message: string): void {
  console.log(`[tasks ${new Date().toISOString()}] ${message}`)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

function readState(file: string): RuntimeState {
  try { return JSON.parse(readFileSync(file, "utf-8")) as RuntimeState } catch { return {} }
}

function writeState(file: string, state: RuntimeState): void {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
}

type ServerConnection = { url: string; headers?: Record<string, string>; password?: string }

async function healthyServer(connection: ServerConnection): Promise<boolean> {
  try {
    const client = createOpencodeClient({ baseUrl: connection.url, headers: connection.headers }) as any
    const health = await client.v2.health.get()
    return health.data?.healthy === true
  } catch {
    return false
  }
}

async function findServer(): Promise<ServerConnection | undefined> {
  const explicit = process.env.OPENCODE_TASKS_SERVER_URL
  if (explicit) {
    const connection = { url: explicit }
    if (await healthyServer(connection)) return connection
  }

  const stateRoots = [
    process.env.XDG_STATE_HOME,
    path.join(os.homedir(), ".local", "state"),
    path.join(os.homedir(), ".local", "share"),
  ].filter((value): value is string => Boolean(value))

  for (const root of stateRoots) {
    const stateDir = path.join(root, "opencode")
    const registrationFile = path.join(stateDir, "server.json")
    if (!existsSync(registrationFile)) continue

    try {
      const registration = JSON.parse(readFileSync(registrationFile, "utf-8")) as { url?: string; pid?: number }
      if (!registration.url || !registration.pid || !alive(registration.pid)) continue
      const passwordFile = path.join(stateDir, "password")
      const password = existsSync(passwordFile) ? readFileSync(passwordFile, "utf-8").trim() : ""
      const headers = password
        ? { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
        : undefined
      const connection = { url: registration.url, headers, password }
      if (await healthyServer(connection)) return connection
    } catch {
      // Ignore stale or malformed registrations.
    }
  }

  const defaultServer = { url: "http://127.0.0.1:4096" }
  if (await healthyServer(defaultServer)) return defaultServer

  return undefined
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function taskLine(line: string): { state: TaskState; raw: string } | undefined {
  const match = line.match(/^- \[([ ~x!✓])\] (.*)$/)
  if (!match) return undefined
  const state = match[1] === " "
    ? "pending"
    : match[1] === "~"
      ? "active"
      : match[1] === "x" || match[1] === "✓"
        ? "done"
        : "blocked"
  return { state, raw: match[2] }
}

function linkPath(raw: string): string {
  return raw.match(/\[[^\]]+\]\(([^)]+)\)/)?.[1] || ""
}

async function runAttached(
  server: ServerConnection,
  stateFile: string,
  slug: string,
  sessionId: string,
  model: string,
  prompt: string,
  permissions: Record<string, unknown>,
): Promise<{ session: string; output: string }> {
  const client = createOpencodeClient({
    baseUrl: server.url,
    headers: server.headers,
    directory: projectRoot,
  }) as any
  const selectedModel = modelValue(model)
  let id = sessionId

  if (!id) {
    const created = await client.session.create({
      title: `task:${slug}`,
      agent: "task-runner",
      model: selectedModel ? { providerID: selectedModel.providerID, id: selectedModel.modelID } : undefined,
      permission: permissionRules(permissions),
    })
    id = created.data?.id || created.id || ""
  }
  if (!id) throw new Error("OpenCode did not return a session ID")

  writeState(stateFile, { pid: process.pid, session: id, status: "running" })
  const result = await client.session.prompt({
    sessionID: id,
    agent: "task-runner",
    model: selectedModel,
    parts: [{ type: "text", text: prompt }],
  })
  if (result.error) throw new Error(JSON.stringify(result.error))
  return { session: id, output: JSON.stringify(result.data ?? result) }
}

type SelectedTask = {
  line: number
  raw: string
  retry: boolean
  followUp: boolean
  session: string
}

function findTask(content: string): SelectedTask | undefined {
  const lines = content.split(/\r?\n/)
  let activeCount = 0

  for (let i = 0; i < lines.length; i++) {
    const parsed = taskLine(lines[i])
    if (!parsed) continue
    if (parsed.state === "active") {
      activeCount++
      const slug = slugify(parsed.raw.match(/\[([^\]]+)\]\(/)?.[1] || parsed.raw)
      const stateFile = taskStateFile(projectRoot, slug)
      if (!existsSync(stateFile)) {
        return { line: i, raw: parsed.raw, retry: true, followUp: false, session: "" }
      }
      const state = readState(stateFile)
      const status = state.status || "success"
      const pid = state.pid || 0
      if (status === "running" && pid && alive(pid)) {
        log(`task=${slug} status=running pid=${pid} action=skip`)
        return undefined
      }
      return {
        line: i,
        raw: parsed.raw,
        retry: true,
        followUp: true,
        session: state.session || "",
      }
    }
  }

  const limit = Number(frontmatterData(content).max_active || 1)
  if (activeCount >= limit) return undefined
  for (let i = 0; i < lines.length; i++) {
    const parsed = taskLine(lines[i])
    if (parsed?.state === "pending") {
      return { line: i, raw: parsed.raw, retry: false, followUp: false, session: "" }
    }
  }
  return undefined
}

async function main(): Promise<void> {
  if (!existsSync(tasksFile)) return
  mkdirSync(stateDir, { recursive: true })
  const server = await findServer()
  log(server ? `server=attached url=${server.url}` : "server=standalone reason=no-matching-server")

  const original = readFileSync(tasksFile, "utf-8")
  const selected = findTask(original)
  if (!selected) {
    log("status=idle reason=no-pending-tasks")
    return
  }

  const slug = slugify(selected.raw.match(/\[([^\]]+)\]\(/)?.[1] || selected.raw)
  const stateFile = taskStateFile(projectRoot, slug)
  const lines = original.split(/\r?\n/)
  if (!selected.retry) {
    lines[selected.line] = lines[selected.line].replace("- [ ]", "- [~]")
    writeFileSync(tasksFile, `${lines.join("\n")}\n`)
  }

  let taskConfig = frontmatterData(original)
  const linked = linkPath(selected.raw)
  if (linked) {
    const linkedFile = path.join(projectRoot, linked)
    if (!existsSync(linkedFile)) {
      lines[selected.line] = lines[selected.line].replace("- [~]", "- [!]")
      writeFileSync(tasksFile, `${lines.join("\n")}\n`)
      throw new Error(`Linked task file not found: ${linked}`)
    }
    const linkedContent = readFileSync(linkedFile, "utf-8")
    taskConfig = mergeFrontmatter(taskConfig, frontmatterData(linkedContent))
  }
  const model = typeof taskConfig.model === "string" ? taskConfig.model : ""
  const taskPermissionRules = taskPermissions(taskConfig)

  const prompt = selected.followUp
    ? "Continue the existing task. Check what is already done. If complete, mark the exact top-level task [x] in TASKS.md. If blocked, mark it [!] and state the blocker. Otherwise finish the remaining work now."
    : selected.raw

  const opencode = process.execPath
  const args = [
    "run",
    "--format",
    "json",
    "--title",
    `task:${slug}`,
    "--agent",
    "task-runner",
  ]
  if (server) {
    args.push("--attach", server.url, "--dir", projectRoot)
    if (server.password) args.push("--password", server.password)
  }
  if (model) args.push("--model", model)
  if (selected.session) args.push("--session", selected.session)

  log(`task=${slug} retry=${selected.retry} follow_up=${selected.followUp}`)
  log(`task=${slug} action=start binary=${opencode}`)

  let exitCode = 0
  let session = selected.session
  let text = ""
  let workerPid = process.pid
  if (server) {
    try {
      const result = await runAttached(server, stateFile, slug, selected.session, model, prompt, taskPermissionRules)
      session = result.session
      text = result.output
    } catch (error) {
      exitCode = 1
      text = error instanceof Error ? error.message : String(error)
    }
  } else {
    const output: Buffer[] = []
    const child = spawn(opencode, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        BUN_BE_BUN: undefined,
        ...(Object.keys(taskPermissionRules).length
          ? { OPENCODE_PERMISSION: JSON.stringify(taskPermissionRules) }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    child.stdout.on("data", (data) => output.push(Buffer.from(data)))
    child.stderr.on("data", (data) => output.push(Buffer.from(data)))
    workerPid = child.pid ?? process.pid
    writeState(stateFile, { pid: child.pid ?? process.pid, status: "running" })
    child.stdin.write(prompt)
    child.stdin.end()
    exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1))
    })
    text = Buffer.concat(output).toString("utf-8")
    session = text.match(/"sessionID":"([^"]+)"/)?.[1] || selected.session
  }

  const status = exitCode === 0 ? "success" : "failed"
  writeState(stateFile, { pid: workerPid, session, status, exit_code: exitCode, output: text.slice(0, 2000) })
  log(`task=${slug} status=${status} exit_code=${exitCode} session=${session || "none"}`)
  process.exitCode = exitCode
}

await main()
