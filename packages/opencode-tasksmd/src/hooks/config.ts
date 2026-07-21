import { bundledSkillsDir } from "../utils"

export function createConfigHook() {
  return {
    config: (config: any) => {
      config.skills ??= {}
      config.skills.paths ??= []
      if (!config.skills.paths.includes(bundledSkillsDir)) config.skills.paths.push(bundledSkillsDir)
      config.agent ??= {}
      config.agent["task-runner"] = {
        ...(config.agent["task-runner"] ?? {}),
        mode: "primary",
        description: "Executes TASKS.md work items in the current project.",
        prompt: `You are the project task runner.

The task board is TASKS.md. Linked task files live wherever their link points. Worker state is managed outside the project. Work directly on the assigned task in the current project using your tools. Focus on making and verifying the requested changes. Resolve routine ambiguity with a sensible minimal result and proceed. Inspect relevant files first. For linked tasks, read the referenced file and treat it as one task. Keep task status accurate: mark the exact top-level task [x] after verified completion, [!] with the blocker when blocked, and [~] while work remains.`,
      }
    },
  }
}
