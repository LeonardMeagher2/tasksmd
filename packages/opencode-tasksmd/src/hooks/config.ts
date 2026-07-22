export function createConfigHook() {
  return {
    config: (config: any) => {
      // Task status tools must be callable by whichever agent runs a task.
      config.tools ??= {}
      config.tools["tasks_done"] = true
      config.tools["tasks_blocked"] = true
    },
  }
}
