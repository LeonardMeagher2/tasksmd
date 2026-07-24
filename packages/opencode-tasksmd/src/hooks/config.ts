export function createConfigHook() {
  return {
    config: (config: any) => {
      config.tools ??= {}
      // Only worker-launched sessions should see task status tools.
      const has_task = Boolean(process.env.OPENCODE_TASKS_SLUG)
      config.tools["task_done"] = has_task
      config.tools["task_blocked"] = has_task
      config.tools["task_info"] = has_task
      config.tools["tasks_debug"] = !has_task
      config.tools["tasks_start"] = !has_task
      config.tools["tasks_stop"] = !has_task
    },
  }
}
