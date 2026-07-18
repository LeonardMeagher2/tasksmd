import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { frontmatterData, mergeFrontmatter, modelValue, permissionRules, taskPermissions, parseEvery } from "./task-config"
import { stateDir, readState, updateTask, writeState, type TaskRunState } from "./state"
import { replaceTask, parseChecklist, type ChecklistTask } from "./checklist"
import { installTaskWorker } from "./tasks-scheduler"

function findOpencode(): string {
  try {
    const cmd = os.platform() === "win32" ? "where.exe" : "sh"
    const args = os.platform() === "win32" ? ["opencode"] : ["-lc", "command -v opencode"]
    return execFileSync(cmd, args, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]
  } catch {
    return ""
  }
}

const projectRoot = path.resolve(process.cwd())
const tasksFile = path.join(projectRoot, "TASKS.md")

function log(message: string): void {
  console.log(`[tasks ${new Date().toISOString()}] ${message}`)
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
    const serverStateDir = path.join(root, "opencode")
    const registrationFile = path.join(serverStateDir, "server.json")
    if (!existsSync(registrationFile)) continue

    try {
      const registration = JSON.parse(readFileSync(registrationFile, "utf-8")) as { url?: string; pid?: number }
      if (!registration.url || !registration.pid || !alive(registration.pid)) continue
      const passwordFile = path.join(serverStateDir, "password")
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

async function runAttached(
  server: ServerConnection,
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

  updateTask(projectRoot, slug, { pid: process.pid, session: id, status: "running" })
  const result = await client.session.prompt({
    sessionID: id,
    agent: "task-runner",
    model: selectedModel,
    parts: [{ type: "text", text: prompt }],
  })
  if (result.error) throw new Error(JSON.stringify(result.error))
  return { session: id, output: JSON.stringify(result.data ?? result) }
}

function findTask(parsed: Checklist): ChecklistTask | undefined {
  const state = readState(projectRoot)
  const scheduledSlugs = new Set(Object.keys(state.schedulers).filter((s) => s !== ""))
  let activeCount = 0

  for (const task of parsed.tasks) {
    if (task.state === "active") {
      activeCount++
      if (scheduledSlugs.has(task.slug)) continue
      const runState = state.tasks[task.slug]
      if (!runState) return task
      if (runState.status === "running" && runState.pid && alive(runState.pid)) {
        log(`task=${task.slug} status=running pid=${runState.pid} action=skip`)
        return undefined
      }
      return task
    }
  }

  const limit = Number(parsed.frontmatter.max_active || 1)
  if (activeCount >= limit) return undefined

  for (const task of parsed.tasks) {
    if (task.state === "pending" && !scheduledSlugs.has(task.slug)) return task
  }

  return undefined
}

async function runTask(task: ChecklistTask, content: string, session: string): Promise<void> {
  const isRetry = task.state === "active"

  if (task.state === "done") {
    const updated = replaceTask(content, task.slug, "pending")
    if (updated) {
      writeFileSync(tasksFile, `${updated}\n`)
      const fresh = readFileSync(tasksFile, "utf-8")
      const parsed = parseChecklist(fresh)
      const found = parsed.tasks.find((t) => t.slug === task.slug)
      if (found) await runTask(found, fresh, "")
      return
    }
  }

  if (!isRetry) {
    const updated = replaceTask(content, task.slug, "active")
    if (updated) writeFileSync(tasksFile, `${updated}\n`)
  }

  let taskConfig = frontmatterData(content)
  if (task.link) {
    const linkedFile = path.join(projectRoot, task.link.path)
    if (!existsSync(linkedFile)) {
      const current = readFileSync(tasksFile, "utf-8")
      const marked = replaceTask(current, task.slug, "blocked")
      if (marked) writeFileSync(tasksFile, `${marked}\n`)
      throw new Error(`Linked task file not found: ${task.link.path}`)
    }
    const linkedContent = readFileSync(linkedFile, "utf-8")
    taskConfig = mergeFrontmatter(taskConfig, frontmatterData(linkedContent))
  }
  const model = typeof taskConfig.model === "string" ? taskConfig.model : ""
  const taskPermissionRules = taskPermissions(taskConfig)

  const prompt = isRetry
    ? "Continue the existing task. Check what is already done. If complete, mark the exact top-level task [x] in TASKS.md. If blocked, mark it [!] and state the blocker. Otherwise finish the remaining work now."
    : task.raw

  const server = await findServer()
  const opencode = findOpencode() || "opencode"
  const args = [
    "run",
    "--format",
    "json",
    "--title",
    `task:${task.slug}`,
    "--agent",
    "task-runner",
  ]
  if (server) {
    args.push("--attach", server.url, "--dir", projectRoot)
    if (server.password) args.push("--password", server.password)
  }
  if (model) args.push("--model", model)
  if (session) args.push("--session", session)

  log(`task=${task.slug} retry=${isRetry} follow_up=${isRetry}`)
  log(`task=${task.slug} action=start binary=${opencode}`)

  let exitCode = 0
  let sessionId = session
  let text = ""
  let workerPid = process.pid
  if (server) {
    try {
      const result = await runAttached(server, task.slug, session, model, prompt, taskPermissionRules)
      sessionId = result.session
      text = result.output
    } catch (error) {
      exitCode = 1
      text = error instanceof Error ? error.message : String(error)
    }
  } else {
    const output: Buffer[] = []
    const child = spawn(opencode, args, {
      cwd: projectRoot,
      windowsHide: true,
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
    updateTask(projectRoot, task.slug, { pid: child.pid ?? process.pid, status: "running" })
    child.stdin.write(prompt)
    child.stdin.end()
    exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1))
    })
    text = Buffer.concat(output).toString("utf-8")
    sessionId = text.match(/"sessionID":"([^"]+)"/)?.[1] || session
  }

  const status = exitCode === 0 ? "success" : "failed"
  const lastCompleted = status === "success" ? new Date().toISOString() : undefined
  updateTask(projectRoot, task.slug, { pid: workerPid, session: sessionId, status, exit_code: exitCode, last_completed: lastCompleted, output: text.slice(0, 2000) })
  log(`task=${task.slug} status=${status} exit_code=${exitCode} session=${sessionId || "none"}`)
  process.exitCode = exitCode
}

async function runTaskBySlug(targetSlug: string): Promise<void> {
  if (!existsSync(tasksFile)) return

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const task = parsed.tasks.find((t) => t.slug === targetSlug)

  if (!task) {
    log(`task=${targetSlug} action=skip reason=not-found`)
    return
  }

  if (task.state === "blocked") {
    log(`task=${targetSlug} action=skip reason=blocked`)
    return
  }

  const state = readState(projectRoot)
  const session = task.state === "active" ? state.tasks[targetSlug]?.session || "" : ""
  await runTask(task, content, session)
}

async function main(): Promise<void> {
  if (!existsSync(tasksFile)) return
  mkdirSync(stateDir(projectRoot), { recursive: true })

  const taskArgIndex = process.argv.indexOf("--task")
  if (taskArgIndex !== -1 && taskArgIndex + 1 < process.argv.length) {
    const targetSlug = process.argv[taskArgIndex + 1]
    await runTaskBySlug(targetSlug)
    return
  }

  const server = await findServer()
  log(server ? `server=attached url=${server.url}` : "server=standalone reason=no-matching-server")

  const content = readFileSync(tasksFile, "utf-8")
  const parsed = parseChecklist(content)
  const selected = findTask(parsed)
  if (!selected) {
    log("status=idle reason=no-pending-tasks")
    return
  }

  await runTask(selected, content, "")

  let taskConfig = frontmatterData(content)
  if (selected.link) {
    const linkedFile = path.join(projectRoot, selected.link.path)
    if (existsSync(linkedFile)) {
      taskConfig = mergeFrontmatter(taskConfig, frontmatterData(readFileSync(linkedFile, "utf-8")))
    }
  }
  const interval = parseEvery(taskConfig.every, 0)
  if (interval > 0) {
    const state = readState(projectRoot)
    if (!state.schedulers[selected.slug]) {
      await installTaskWorker(projectRoot, selected.slug, interval)
      state.schedulers[selected.slug] = interval
      writeState(projectRoot, state)
      log(`task=${selected.slug} scheduler=installed interval=${interval}s`)
    }
  }
}

await main()
