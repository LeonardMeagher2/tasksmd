import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"

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
  const tasksFile = path.join(dir, "TASKS.md")
  if (!existsSync(tasksFile)) return

  const content = readFileSync(tasksFile, "utf-8")
  const defaultModel = readFrontmatterKey(content, "model")

  const pending = pendingTasks(content)
  if (pending.length === 0) return

  const task = pending[0]
  const slug = slugify(extractLinkText(task.raw) || task.raw)
  const stateFile = path.join(dir, ".tasks", ".state", `${slug}.md`)

  // Check if already running
  if (existsSync(stateFile)) {
    const sc = readFileSync(stateFile, "utf-8")
    const pm = sc.match(/^pid:\s*(\d+)/m)
    const status = sc.match(/^status:\s*(\S+)/m)?.[1] || "success"
    if (status === "running" && pm) {
      try { process.kill(parseInt(pm[1], 10), 0); return } catch { /* stale */ }
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


  // Mark [ ] → [~]
  const lines = content.split("\n")
  lines[task.idx] = lines[task.idx].replace("- [ ]", "- [~]")
  writeFileSync(tasksFile, lines.join("\n"), "utf-8")

  // Write PID to state for crash tracking
  mkdirSync(path.dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, `pid: ${process.pid}\nstatus: running\n`, "utf-8")

  try {
    const sdk = client as any
    const session = await sdk.session.create({ body: { title: `task:${slug}` } })
    const sessionId = session?.id || session?.info?.id || ""

    writeFileSync(stateFile, `pid: ${process.pid}\nsession: ${sessionId}\nstatus: running\n`, "utf-8")

    const parsedModel = parseModelStr(model)
    await sdk.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: prompt }],
        model: parsedModel,
        agent: "task-runner",
      },
    })

    writeFileSync(stateFile, readFileSync(stateFile, "utf-8").replace(/^status:.*$/m, "status: success"), "utf-8")
  } catch (e) {
    if (existsSync(stateFile)) {
      writeFileSync(stateFile, readFileSync(stateFile, "utf-8").replace(/^status:.*$/m, "status: failed"), "utf-8")
    }
    // Leave [~] — the caller will fall back to the worker, which can retry.
    throw e
  }
}
