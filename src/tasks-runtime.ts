import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"
import { frontmatterData, mergeFrontmatter, modelValue, permissionRules, taskPermissions } from "./task-config"
import { taskStateDir, taskStateFile } from "./tasks-state"

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
  let taskConfig = frontmatterData(content)
  const defaultModel = typeof taskConfig.model === "string" ? taskConfig.model : ""

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
      taskConfig = mergeFrontmatter(taskConfig, frontmatterData(tc))
      model = typeof taskConfig.model === "string" ? taskConfig.model : defaultModel
      prompt = task.raw
    }
  }
  const permissions = taskPermissions(taskConfig)


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
        permission: permissionRules(permissions),
      },
    })
    const sessionId = session?.id || session?.info?.id || ""

    writeState(stateFile, { pid: process.pid, session: sessionId, status: "running" })

    const parsedModel = modelValue(model)
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
