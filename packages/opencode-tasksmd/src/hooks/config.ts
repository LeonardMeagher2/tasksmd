export function createConfigHook() {
  return {
    config: (config: any) => {
      config.tools ??= {}
      // Only worker-launched sessions should see task status tools.
      const enabled = Boolean(process.env.OPENCODE_TASKS_SLUG)
      config.tools["tasks_done"] = enabled
      config.tools["tasks_blocked"] = enabled
    },
  }
}
