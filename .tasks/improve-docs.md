---
model: ollama/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
---

Update the project README and inline comments to reflect the current architecture.

## Changes needed

- README no longer mentions `.opencode/tasks/worker.sh` or `worker.ps1`; document the embedded Bun worker
- Remove stale references to `/tasks` as a skill command
- Update the project tree diagram to match the current file layout
- Add a brief packaging / development section if helpful

## Acceptance criteria

- No stale references to the old workers
- Tree diagram matches the current project structure
- The README accurately describes how the system works end-to-end
