# @leonardmeagher2/tasksmd

## 0.6.0

### Minor Changes

- be5ef29: Add `stripFrontmatter.

  `tasksmd` gains a `stripFrontmatter(content)` export: the document body with
  its leading YAML frontmatter block removed. The content is returned unchanged
  when there is no frontmatter block or it is never closed.

- be5ef29: Rename `frontmatter` to `parseFrontmatter`, and `Board.path` to
  `Board.boardPath`.

  `frontmatter(content)` is now `parseFrontmatter(content)`, matching the verb
  naming of `parseChecklist`, `serializeFrontmatter`, `mergeFrontmatter`, and
  `stripFrontmatter`. `Board.path` is now `Board.boardPath`, matching
  `TaskContext.boardPath`. Both are breaking changes for callers.

### Patch Changes

- be5ef29: Align package READMEs with current tool behavior.

  The `tasksmd` README now distinguishes state updates from structural updates
  and documents the exact return values of `create`, `addTask`, and
  `removeTask`.

## 0.5.0

### Minor Changes

- 465dcd4: Ship TypeScript declarations.

  The package published `dist/index.js` with no `types` entry, so consumers saw
  `any` for everything it exports — including `Checklist`, `ChecklistTask`,
  `parseChecklist`, and `taskContext`. The build now emits `.d.ts` files alongside
  the bundle and the package declares both `types` and an `exports` map.

  The `exports` map only declares the package root. If you were importing an
  internal path such as `@leonardmeagher2/tasksmd/dist/checklist`, import from the
  package root instead.

## 0.4.0

### Minor Changes

- Add operations to create boards, add/remove tasks, and modify frontmatter

## 0.3.0

### Minor Changes

- Get all tasks working
