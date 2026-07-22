import { bundledSkillsDir } from "../utils"

export function createConfigHook() {
  return {
    config: (config: any) => {
      config.skills ??= {}
      config.skills.paths ??= []
      if (!config.skills.paths.includes(bundledSkillsDir)) config.skills.paths.push(bundledSkillsDir)
      // Task status tools must be callable by whichever agent runs a task.
      config.tools ??= {}
      config.tools["tasks_done"] = true
      config.tools["tasks_blocked"] = true
    },
  }
}
