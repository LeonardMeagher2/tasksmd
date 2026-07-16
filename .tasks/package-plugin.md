---
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
---

Prepare the project for release as an npm package (`opencode-tasks`).

## Requirements

- Add `package.json` with proper metadata (`@opencode-ai/tasks`, description, version, files array)
- Add `tsconfig.json` for the plugin source
- Add build script (`bun run build`) that compiles TypeScript plugin to `dist/`
- Verify skill and worker assets are included in `files`
- Add `LICENSE` (MIT)
- Add a `.gitignore` if needed
- Ensure `worker.ts` references `@opencode-ai/sdk/v2/client` from the package, not from a project path
- Test that the plugin loads when referenced via `"plugin": ["opencode-tasks"]`

## Acceptance criteria

- `npm pack --dry-run` shows only intended files
- A fresh project can add the plugin to `opencode.json` and it loads
- The `task-runner` agent appears in the agent list
- The `tasks` skill is discoverable
- The scheduler can be installed via `start_tasks_worker` tool
