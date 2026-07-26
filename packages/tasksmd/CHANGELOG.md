# @leonardmeagher2/tasksmd

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
