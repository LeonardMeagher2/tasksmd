---
"@leonardmeagher2/opencode-tasksmd": patch
---

Include linked task file content in fresh worker prompts, with truncation at 6000 characters.

Fresh prompts now include a "Linked task context" section when a task links to a Markdown file.
Long linked content is truncated with a clear marker, while resume and recurring prompts stay unchanged.
