import { spawn } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"

import { workerAsset } from "./utils"

type Platform = "darwin" | "linux" | "win32"
const platform: Platform = os.platform() as Platform

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore" })
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Exit code ${code}: ${command} ${args.join(" ")}`)))
    child.on("error", reject)
  })
}

function dirSlug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "").toLowerCase()
}

function workerCmd(dir: string, taskSlug?: string): { program: string; args: string[] } {
  const program = process.execPath
  const extra = taskSlug ? ["--task", taskSlug] : []
  return {
    program,
    args: ["run", workerAsset(dir), ...extra],
  }
}

function winWorkerWrapper(dir: string, taskSlug?: string): string {
  const cmd = workerCmd(dir, taskSlug)
  const lines = [`@set BUN_BE_BUN=1`, `@"${cmd.program}" ${cmd.args.map(a => `"${a}"`).join(" ")}`]
  const slugPart = taskSlug ? `-${taskSlug}` : ""
  const wrapperPath = path.join(dir, ".opencode", "tasks", `worker${slugPart}.cmd`)
  writeFileSync(wrapperPath, lines.join("\r\n"), "utf-8")
  return wrapperPath
}

function taskLabel(dir: string, slug: string): string {
  return `com.opencode.tasksmd.worker.${dirSlug(dir)}${slug ? "." + slug : ""}`
}

function taskPlistPath(dir: string, slug: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${taskLabel(dir, slug)}.plist`)
}

async function installTaskLaunchd(dir: string, slug: string, interval: number): Promise<string> {
  const plist = taskPlistPath(dir, slug)
  const cmd = workerCmd(dir, slug)

  mkdirSync(path.dirname(plist), { recursive: true })

  const args = [cmd.program, ...cmd.args].map((a) =>
    `        <string>${a}</string>`
  ).join("\n")

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${taskLabel(dir, slug)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>WorkingDirectory</key>
    <string>${dir}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BUN_BE_BUN</key>
        <string>1</string>
    </dict>
    <key>StartInterval</key>
    <integer>${interval}</integer>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`

  writeFileSync(plist, content, "utf-8")
  await run("launchctl", ["load", plist])
  return `Task worker installed (launchd): ${taskLabel(dir, slug)}`
}

async function uninstallTaskLaunchd(dir: string, slug: string): Promise<string> {
  const plist = taskPlistPath(dir, slug)
  if (!existsSync(plist)) return `No worker plist found for ${slug || "board"} in ${dir}.`
  try { await run("launchctl", ["unload", plist]) } catch { /* ok */ }
  rmSync(plist, { force: true })
  return `Task worker removed (launchd): ${taskLabel(dir, slug)}`
}

function taskServiceName(dir: string, slug: string): string {
  return `opencode-tasksmd-${dirSlug(dir)}${slug ? "-" + slug : ""}`
}

async function installTaskSystemd(dir: string, slug: string, interval: number): Promise<string> {
  const sdDir = path.join(os.homedir(), ".config", "systemd", "user")
  const name = taskServiceName(dir, slug)
  const cmd = workerCmd(dir, slug)
  const exe = cmd.program
  const args = cmd.args.join(" ")
  const intervalSec = `${interval}sec`

  mkdirSync(sdDir, { recursive: true })

  const service = `[Unit]
Description=OpenCode task worker for ${slug} in ${dirSlug(dir)}

[Service]
Type=exec
WorkingDirectory=${dir}
ExecStart=${exe} ${args}
Environment=BUN_BE_BUN=1
Restart=no
`

  const timer = `[Unit]
Description=OpenCode task worker timer for ${slug} in ${dirSlug(dir)}

[Timer]
OnBootSec=1min
OnUnitActiveSec=${intervalSec}
Persistent=true

[Install]
WantedBy=timers.target
`

  writeFileSync(path.join(sdDir, `${name}.service`), service, "utf-8")
  writeFileSync(path.join(sdDir, `${name}.timer`), timer, "utf-8")
  await run("systemctl", ["--user", "daemon-reload"])
  await run("systemctl", ["--user", "enable", `${name}.timer`])
  await run("systemctl", ["--user", "start", `${name}.timer`])

  return `Task worker installed (systemd): ${name}`
}

async function uninstallTaskSystemd(dir: string, slug: string): Promise<string> {
  const name = taskServiceName(dir, slug)
  const sdDir = path.join(os.homedir(), ".config", "systemd", "user")

  try { await run("systemctl", ["--user", "stop", `${name}.timer`]) } catch { /* ok */ }
  try { await run("systemctl", ["--user", "disable", `${name}.timer`]) } catch { /* ok */ }

  rmSync(path.join(sdDir, `${name}.timer`), { force: true })
  rmSync(path.join(sdDir, `${name}.service`), { force: true })
  return `Task worker removed (systemd): ${name}`
}

function taskTaskName(dir: string, slug: string): string {
  return `OpenCodeTasks-${dirSlug(dir)}${slug ? "-" + slug : ""}`
}

function taskXml(wrapperPath: string, interval: number): string {
  const minutes = Math.max(1, Math.round(interval / 60))
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "")
  const schedUser = `${os.userInfo().username}\\${os.hostname()}`
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>${now}</Date>
    <Author>${schedUser}</Author>
    <URI>\\OpenCodeTasks-worker</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <AllowStartOnDemand>true</AllowStartOnDemand>
  </Settings>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>2000-01-01T00:00:00</StartBoundary>
      <Repetition>
        <Interval>PT${minutes}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/c ${wrapperPath}</Arguments>
    </Exec>
  </Actions>
</Task>`
}

async function installTaskWin32(dir: string, slug: string, interval: number): Promise<string> {
  const name = taskTaskName(dir, slug)
  const wrapperPath = winWorkerWrapper(dir, slug)
  const xml = taskXml(wrapperPath, interval)
  const xmlPath = path.join(dir, ".opencode", "tasks", `sched-${slug || "board"}.xml`)
  // schtasks rejects UTF-16 XML without a byte order mark.
  writeFileSync(xmlPath, `﻿${xml}`, "utf16le")
  await run("schtasks", ["/Create", "/TN", name, "/XML", xmlPath, "/F"])
  rmSync(xmlPath, { force: true })
  return `Task worker installed (Task Scheduler): ${name}`
}

async function uninstallTaskWin32(dir: string, slug: string): Promise<string> {
  const name = taskTaskName(dir, slug)
  try {
    await run("schtasks", ["/Delete", "/TN", name, "/F"])
  } catch { /* ok */ }
  const slugPart = slug ? `-${slug}` : ""
  const wrapperPath = path.join(dir, ".opencode", "tasks", `worker${slugPart}.cmd`)
  if (existsSync(wrapperPath)) rmSync(wrapperPath, { force: true })
  return `Task worker removed (Task Scheduler): ${name}`
}

export async function installTaskWorker(dir: string, slug: string, interval: number): Promise<string> {
  switch (platform) {
    case "darwin": return installTaskLaunchd(dir, slug, interval)
    case "linux":  return installTaskSystemd(dir, slug, interval)
    case "win32":  return installTaskWin32(dir, slug, interval)
    default:       throw new Error(`Unsupported platform: ${platform}`)
  }
}

export async function uninstallTaskWorker(dir: string, slug: string): Promise<string> {
  switch (platform) {
    case "darwin": return uninstallTaskLaunchd(dir, slug)
    case "linux":  return uninstallTaskSystemd(dir, slug)
    case "win32":  return uninstallTaskWin32(dir, slug)
    default:       throw new Error(`Unsupported platform: ${platform}`)
  }
}
