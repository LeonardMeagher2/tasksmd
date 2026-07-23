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
