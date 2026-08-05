---
"@leonardmeagher2/tasksmd": minor
"@leonardmeagher2/opencode-tasksmd": patch
---

Add `stripFrontmatter` to tasksmd, and stop injecting linked-task frontmatter
into worker prompts.

`tasksmd` gains a `stripFrontmatter(content)` export: the document body with
its leading YAML frontmatter block removed. The content is returned unchanged
when there is no frontmatter block or it is never closed.

`opencode-tasksmd` now uses it for linked task context. A linked file's
frontmatter is config — already merged into the run — so it no longer appears
in the first prompt or in `task_info` output.
