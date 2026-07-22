export type PluginClient = {
  tui: { showToast: (params: any) => Promise<any> }
}

export type StatusVariant = "info" | "success" | "warning" | "error"
