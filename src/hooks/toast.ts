import type { PluginClient, StatusVariant } from "../types"

export async function showToast(
  client: PluginClient,
  message: string,
  variant: StatusVariant = "info",
  title?: string,
  duration?: number,
): Promise<void> {
  try {
    await client.tui.showToast({
      body: { title, message, variant, duration },
    })
  } catch {
    // TUI may not be available (headless, web)
  }
}

export async function sendInlineStatus(
  client: PluginClient,
  sessionID: string,
  text: string,
  agent?: string,
): Promise<void> {
  try {
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        agent,
        parts: [{ type: "text", text, ignored: true }],
      },
    })
  } catch {
    // Session may not be active
  }
}
