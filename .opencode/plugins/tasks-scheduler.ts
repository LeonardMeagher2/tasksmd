import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"

type Platform = "darwin" | "linux" | "win32"

function slug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "").toLowerCase()
}

function workerCmd(dir: string): { program: string; args: string[] } {
  const config = path.join(dir, ".tasks", "config")
  let program = process.execPath
  if (existsSync(config)) {
    const line = readFileSync(config, "utf-8").split(/\r?\n/).find((item) => item.startsWith("opencode_path="))
    if (line) program = line.slice("opencode_path=".length)
  }
  const worker = path.join(dir, ".opencode", "tasks", "worker.ts")
  if (os.platform() === "win32") {
    const quote = (value: string) => value.replace(/'/g, "''")
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-Command", `$env:BUN_BE_BUN='1'; & '${quote(program)}' run '${quote(worker)}'`],
    }
  }
  return {
    program,
    args: ["run", worker],
  }
}

function label(dir: string): string {
  return `com.opencode.tasks.worker.${slug(dir)}`
}

function plistPath(dir: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label(dir)}.plist`)
}

function installLaunchd(dir: string): string {
  const plist = plistPath(dir)
  const cmd = workerCmd(dir)
  const log = path.join(dir, ".tasks", "worker.log")

  mkdirSync(path.dirname(plist), { recursive: true })

  const args = [cmd.program, ...cmd.args].map((a) =>
    `        <string>${a}</string>`
  ).join("\n")

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label(dir)}</string>
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
    <integer>300</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${log}</string>
    <key>StandardErrorPath</key>
    <string>${log}</string>
</dict>
</plist>`

  writeFileSync(plist, content, "utf-8")
  execSync(`launchctl load ${plist}`)
  return `Worker installed (launchd): ${label(dir)}`
}

function uninstallLaunchd(dir: string): string {
  const plist = plistPath(dir)
  if (!existsSync(plist)) return "No worker plist found."
  try { execSync(`launchctl unload ${plist}`, { stdio: "pipe" }) } catch { /* ok */ }
  rmSync(plist, { force: true })
  return `Worker removed (launchd): ${label(dir)}`
}

function systemdDir(): string {
  return path.join(os.homedir(), ".config", "systemd", "user")
}

function serviceName(dir: string): string {
  return `opencode-tasks-${slug(dir)}`
}

function installSystemd(dir: string): string {
  const sdDir = systemdDir()
  const name = serviceName(dir)
  const cmd = workerCmd(dir)
  const exe = cmd.program
  const args = cmd.args.join(" ")
  const log = path.join(dir, ".tasks", "worker.log")

  mkdirSync(sdDir, { recursive: true })

  const service = `[Unit]
Description=OpenCode tasks worker for ${slug(dir)}

[Service]
Type=exec
WorkingDirectory=${dir}
ExecStart=${exe} ${args}
Environment=BUN_BE_BUN=1
Restart=no
StandardOutput=append:${log}
StandardError=append:${log}
`

  const timer = `[Unit]
Description=OpenCode tasks worker timer for ${slug(dir)}

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
`

  writeFileSync(path.join(sdDir, `${name}.service`), service, "utf-8")
  writeFileSync(path.join(sdDir, `${name}.timer`), timer, "utf-8")
  execSync(`systemctl --user daemon-reload`, { stdio: "pipe" })
  execSync(`systemctl --user enable ${name}.timer`, { stdio: "pipe" })
  execSync(`systemctl --user start ${name}.timer`, { stdio: "pipe" })

  return `Worker installed (systemd): ${name}`
}

function uninstallSystemd(dir: string): string {
  const name = serviceName(dir)
  const sdDir = systemdDir()

  try { execSync(`systemctl --user stop ${name}.timer 2>/dev/null`, { stdio: "pipe" }) } catch { /* ok */ }
  try { execSync(`systemctl --user disable ${name}.timer 2>/dev/null`, { stdio: "pipe" }) } catch { /* ok */ }

  rmSync(path.join(sdDir, `${name}.timer`), { force: true })
  rmSync(path.join(sdDir, `${name}.service`), { force: true })
  return `Worker removed (systemd): ${name}`
}

function taskName(dir: string): string {
  return `OpenCodeTasks-${slug(dir)}`
}

function installWin32(dir: string): string {
  const name = taskName(dir)
  const cmd = workerCmd(dir)
  const tr = `${cmd.program} ${cmd.args.join(" ")}`

  execSync(
    `schtasks /Create /SC MINUTE /MO 5 /TN "${name}" /TR "${tr}" /F`,
    { stdio: "pipe" },
  )
  return `Worker installed (Task Scheduler): ${name}`
}

function uninstallWin32(dir: string): string {
  const name = taskName(dir)
  try {
    execSync(`schtasks /Delete /TN "${name}" /F`, { stdio: "pipe" })
  } catch { /* ok */ }
  return `Worker removed (Task Scheduler): ${name}`
}

const platform: Platform = os.platform() as Platform

export function installWorker(dir: string): string {
  switch (platform) {
    case "darwin": return installLaunchd(dir)
    case "linux":  return installSystemd(dir)
    case "win32":  return installWin32(dir)
    default:       throw new Error(`Unsupported platform: ${platform}`)
  }
}

export function uninstallWorker(dir: string): string {
  switch (platform) {
    case "darwin": return uninstallLaunchd(dir)
    case "linux":  return uninstallSystemd(dir)
    case "win32":  return uninstallWin32(dir)
    default:       throw new Error(`Unsupported platform: ${platform}`)
  }
}

export function isWorkerInstalled(dir: string): boolean {
  switch (platform) {
    case "darwin": return existsSync(plistPath(dir))
    case "linux":  return existsSync(path.join(systemdDir(), `${serviceName(dir)}.timer`))
    case "win32": {
      try {
        execSync(`schtasks /Query /TN "${taskName(dir)}"`, { stdio: "pipe" })
        return true
      } catch { return false }
    }
    default: return false
  }
}
