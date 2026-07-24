export function createConfigHook() {
  return {
    config: (config: any) => {
      config.tools ??= {}
      // Only worker-launched sessions should see task status tools.
      const enabled = Boolean(process.env.OPENCODE_TASKS_SLUG)
      config.tools["task_done"] = enabled
      config.tools["task_blocked"] = enabled
      config.tools["task_info"] = enabled
    },
  }
}
