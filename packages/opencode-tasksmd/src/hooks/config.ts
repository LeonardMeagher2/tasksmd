import { bundledSkillsDir } from "../utils"

export function createConfigHook() {
  return {
    config: (config: any) => {
      config.skills ??= {}
      config.skills.paths ??= []
      if (!config.skills.paths.includes(bundledSkillsDir)) config.skills.paths.push(bundledSkillsDir)
    },
  }
}
