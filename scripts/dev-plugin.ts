import { rm } from "node:fs/promises"

// Local development bundle: a single self-contained plugin file that OpenCode
// can load without resolving any bare imports (the background dependency
// installer fails on this machine's "local" build, so we bypass it).
//
// Rebuild with: bun run dev

const outDir = ".opencode/plugins"

const result = await Bun.build({
  entrypoints: ["packages/opencode-tasksmd/src/index.ts"],
  outdir: outDir,
  target: "node",
  compile: false,
  naming: "tasks.js",
  format: "esm",
  minify: true,
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await rm(".opencode/tasks", { recursive: true, force: true })

console.log("Local plugin bundle: .opencode/plugins/tasks.js")
