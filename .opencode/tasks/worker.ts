#!/usr/bin/env bun
import { $ } from "bun"
import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

// ── Paths ──────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dir, "../..")
const TASKS_FILE = path.join(PROJECT_ROOT, "TASKS.md")
const TASKS_DIR = path.join(PROJECT_ROOT, ".tasks")
const STATE_DIR = path.join(TASKS_DIR, ".state")
const WORKTREE_BASE = path.join(PROJECT_ROOT, ".worktrees")

await mkdir(STATE_DIR, { recursive: true })
await mkdir(WORKTREE_BASE, { recursive: true })

// ── Utils ──────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

function extractFrontmatter(
  content: string,
): { frontmatter: Record<string, string>; body: string } {
  const lines = content.split("\n")
  const frontmatter: Record<string, string> = {}
  let inFrontmatter = false
  let frontmatterEnd = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true
        continue
      } else {
        frontmatterEnd = i + 1
        break
      }
    }
    if (inFrontmatter) {
      const sep = line.indexOf(":")
      if (sep > 0) {
        const key = line.slice(0, sep).trim()
        const val = line.slice(sep + 1).trim()
        frontmatter[key] = val
      }
    }
  }

  return {
    frontmatter,
    body: lines.slice(frontmatterEnd).join("\n"),
  }
}

function parseCheckboxLine(
  line: string,
): { state: "pending" | "active" | "done"; raw: string } | null {
  const m = line.match(/^- \[([ ~x])\](.+)/)
  if (!m) return null
  const state = m[1] === " " ? "pending" as const : m[1] === "~" ? "active" as const : "done" as const
  return { state, raw: m[2].trim() }
}

function extractLink(line: string): { text: string; path: string } | null {
  const m = line.match(/\[([^\]]+)\]\(([^)]+)\)/)
  if (!m) return null
  return { text: m[1], path: m[2] }
}

function slugFromLink(line: string): string | null {
  const link = extractLink(line)
  if (!link) return null
  // .tasks/foo.md → foo
  return path.basename(link.path, ".md")
}

function slugFromLine(line: string): string {
  const link = extractLink(line)
  if (link) return slugify(link.text)
  // Remove inline --model flag for slug
  const text = line.replace(/--model\s+\S+/, "").trim()
  return slugify(text)
}

// ── Main ───────────────────────────────────────────────

async function main() {
  if (!existsSync(TASKS_FILE)) {
    console.log("No TASKS.md found.")
    process.exit(0)
  }

  const content = await readFile(TASKS_FILE, "utf-8")
  const { frontmatter, body } = extractFrontmatter(content)
  const defaultModel = frontmatter["model"] || ""
  const maxActive = parseInt(frontmatter["max_active"] || "1", 10)
  const lines = body.split("\n")

  // ── Find next task ─────────────────────────────────

  let taskIdx = -1
  let taskState: "pending" | "active" | "done" = "pending"
  let taskRaw = ""
  let isRetry = false

  // Priority 1: stale [~] with existing worktree
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseCheckboxLine(lines[i])
    if (parsed?.state === "active") {
      const slug = slugFromLine(parsed.raw) || slugify(parsed.raw)
      if (existsSync(path.join(WORKTREE_BASE, slug))) {
        taskIdx = i; taskState = "active"; taskRaw = parsed.raw; isRetry = true
        break
      }
    }
  }

  // Priority 2: first [ ] if under max_active
  if (taskIdx === -1) {
    const activeCount = lines.filter((l) => parseCheckboxLine(l)?.state === "active").length
    if (activeCount >= maxActive) {
      console.log(`Active tasks (${activeCount}) >= max_active (${maxActive}). Exiting.`)
      process.exit(0)
    }
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseCheckboxLine(lines[i])
      if (parsed?.state === "pending") {
        taskIdx = i; taskState = "pending"; taskRaw = parsed.raw
        break
      }
    }
  }

  if (taskIdx === -1) {
    console.log("No pending tasks.")
    process.exit(0)
  }

  const slug = slugFromLine(taskRaw) || slugify(taskRaw)
  console.log(`Task: ${taskRaw}`)
  console.log(`Slug: ${slug}`)
  console.log(`Linked: ${extractLink(taskRaw) ? "yes" : "no"}`)
  console.log(`Retry: ${isRetry}`)

  // ── Resolve prompt and model ──────────────────────

  let prompt = ""
  let model = defaultModel
  const link = extractLink(taskRaw)

  if (link) {
    const taskFile = path.join(PROJECT_ROOT, link.path)
    if (!existsSync(taskFile)) {
      console.error(`Linked task file not found: ${taskFile}`)
      process.exit(1)
    }
    const taskContent = await readFile(taskFile, "utf-8")
    const taskFm = extractFrontmatter(taskContent)
    model = taskFm.frontmatter["model"] || defaultModel
    prompt = taskFm.body.trim()
  } else {
    prompt = taskRaw.replace(/--model\s+\S+/g, "").trim()
  }

  // ── Retry context injection ───────────────────────

  if (isRetry) {
    const stateFile = path.join(STATE_DIR, `${slug}.md`)
    if (existsSync(stateFile)) {
      const stateContent = await readFile(stateFile, "utf-8")
      prompt = `Previous attempt context:\n${stateContent}\n\n--- task below ---\n\n${prompt}`
    }
  }

  // ── Worktree ──────────────────────────────────────

  const worktreeDir = path.join(WORKTREE_BASE, slug)
  if (!existsSync(worktreeDir)) {
    await $`git -C ${PROJECT_ROOT} worktree add ${worktreeDir} HEAD`.quiet()
  }

  // ── Mark as in-progress ───────────────────────────

  if (!isRetry) {
    const updatedLines = [...lines]
    const line = updatedLines[taskIdx]
    updatedLines[taskIdx] = line.replace("- [ ]", "- [~]")
    const newContent = content.slice(0, content.indexOf(body)) + updatedLines.join("\n")
    await writeFile(TASKS_FILE, newContent, "utf-8")
  }

  // ── Run opencode ──────────────────────────────────

  const args = ["run", "--format", "json", "--title", `task:${slug}`]
  if (model) args.push("--model", model)
  args.push("-p", prompt)

  console.log(`Running: opencode ${args.join(" ")}`)

  const child = spawn("opencode", args, { cwd: worktreeDir, stdio: ["ignore", "pipe", "pipe"] })

  let output = ""
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })

  const exitCode = await new Promise<number>((resolve) => child.on("close", resolve))

  // ── Save state ────────────────────────────────────

  const sessionMatch = output.match(/"sessionID":"([^"]+)"/)
  const sessionId = sessionMatch?.[1] || ""

  await writeFile(
    path.join(STATE_DIR, `${slug}.md`),
    `session: ${sessionId}\nexit_code: ${exitCode}\n\noutput:\n${output.slice(0, 2000)}`,
    "utf-8",
  )

  // ── Handle result ─────────────────────────────────

  const updatedLines = (await readFile(TASKS_FILE, "utf-8")).split("\n")
  const globalIdx = updatedLines.findIndex((l) => l.includes(`[~]`) && slugFromLine(l) === slug)

  if (exitCode === 0) {
    if (globalIdx !== -1) {
      updatedLines[globalIdx] = updatedLines[globalIdx].replace("- [~]", "- [x]")
      await writeFile(TASKS_FILE, updatedLines.join("\n"), "utf-8")
    }
    await rm(path.join(STATE_DIR, `${slug}.md`), { force: true })
    console.log(`Task completed: ${slug}`)
  } else {
    console.log(`Failed (exit ${exitCode}). State saved.`)
  }

  process.exit(exitCode)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
