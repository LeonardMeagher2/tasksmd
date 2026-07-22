import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

export type ServerConnection = { url: string; headers?: Record<string, string>; password?: string }

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function findOpencode(): string {
  try {
    const cmd = os.platform() === "win32" ? "where.exe" : "sh"
    const args = os.platform() === "win32" ? ["opencode"] : ["-lc", "command -v opencode"]
    return execFileSync(cmd, args, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]
  } catch {
    return ""
  }
}

async function healthyServer(connection: ServerConnection): Promise<boolean> {
  try {
    const client = createOpencodeClient({ baseUrl: connection.url, headers: connection.headers }) as any
    const health = await client.v2.health.get()
    return health.data?.healthy === true
  } catch {
    return false
  }
}

export async function findServer(): Promise<ServerConnection | undefined> {
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
