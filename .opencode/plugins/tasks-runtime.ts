import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"

function log(dir: string, msg: string): void {
  const dbgFile = path.join(dir, ".tasks", ".debug")
  if (existsSync(dbgFile)) process.stderr.write(`[tasks] ${msg}\n`)
}

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
  let c = 0
  for (const line of content.split("\n")) {
    if (line.trim() === "---") { c++; continue }
    if (c === 1 && line.toLowerCase().startsWith(key.toLowerCase())) {
      const val = line.slice(line.indexOf(":") + 1).trim()
      return val
    }
    if (c > 1) break
  }
  return ""
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
  log(dir, "tryRunTask called")
  const tasksFile = path.join(dir, "TASKS.md")
  if (!existsSync(tasksFile)) { log(dir, "TASKS.md not found"); return }

  const content = readFileSync(tasksFile, "utf-8")
  const defaultModel = readFrontmatterKey(content, "model")
  log(dir, `defaultModel: ${defaultModel}`)

  const pending = pendingTasks(content)
  log(dir, `pending tasks: ${pending.length}`)
  if (pending.length === 0) return

  const task = pending[0]
  const slug = slugify(extractLinkText(task.raw) || task.raw)
  log(dir, `first pending: slug=${slug}, raw=${task.raw}, idx=${task.idx}`)
  const stateFile = path.join(dir, ".tasks", ".state", `${slug}.md`)

  // Check if already running
  if (existsSync(stateFile)) {
    log(dir, "state file exists, checking PID")
    const sc = readFileSync(stateFile, "utf-8")
    const pm = sc.match(/^pid:\s*(\d+)/m)
    const status = sc.match(/^status:\s*(\S+)/m)?.[1] || "running"
    if (status === "running" && pm) {
      try { process.kill(parseInt(pm[1], 10), 0); log(dir, "PID still alive, skipping"); return } catch { log(dir, "stale PID, proceeding") }
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
      model = readFrontmatterKey(tc, "model") || defaultModel
      prompt = task.raw
    }
  }

  log(dir, `model=${model}, prompt=${prompt.slice(0, 60)}`)

  prompt = `@tasks\n\nTask from TASKS.md:\n${prompt}`

  // Mark [ ] → [~]
  const lines = content.split("\n")
  lines[task.idx] = lines[task.idx].replace("- [ ]", "- [~]")
  writeFileSync(tasksFile, lines.join("\n"), "utf-8")
  log(dir, "marked [ ] → [~]")

  // Write PID to state for crash tracking
  mkdirSync(path.dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, `pid: ${process.pid}\nstatus: running\n`, "utf-8")
  log(dir, "state file written")

  try {
    const sdk = client as any
    const session = await sdk.session.create({ body: { title: `task:${slug}` } })
    const sessionId = session?.id || session?.info?.id || ""
    log(dir, `session created: ${sessionId}`)

    writeFileSync(stateFile, `pid: ${process.pid}\nsession: ${sessionId}\nstatus: running\n`, "utf-8")

    const parsedModel = parseModelStr(model)
    log(dir, `prompting session with model ${JSON.stringify(parsedModel)}`)
    await sdk.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: prompt }],
        model: parsedModel,
        agent: "build",
      },
    })

    log(dir, "prompt completed; task left [~] for review")
    writeFileSync(stateFile, readFileSync(stateFile, "utf-8").replace(/^status:.*$/m, "status: success"), "utf-8")
    log(dir, "state file kept for debugging")
  } catch (e) {
    if (existsSync(stateFile)) {
      writeFileSync(stateFile, readFileSync(stateFile, "utf-8").replace(/^status:.*$/m, "status: failed"), "utf-8")
    }
    log(dir, `prompt failed: ${e}`)
    // Leave [~] — cron worker will retry
  }
}
