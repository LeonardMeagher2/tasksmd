---
"@leonardmeagher2/tasksmd": minor
---

Rename `frontmatter` to `parseFrontmatter`, and `Board.path` to
`Board.boardPath`.

`frontmatter(content)` is now `parseFrontmatter(content)`, matching the verb
naming of `parseChecklist`, `serializeFrontmatter`, `mergeFrontmatter`, and
`stripFrontmatter`. `Board.path` is now `Board.boardPath`, matching
`TaskContext.boardPath`. Both are breaking changes for callers.
