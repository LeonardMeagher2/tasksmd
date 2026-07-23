import { cp, mkdir } from "node:fs/promises"

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

// The worker asset is installed from a sibling of the plugin file in
// source/dist mode; in bundle mode we place it directly.
await mkdir(".opencode/tasks", { recursive: true })
await cp("packages/opencode-tasksmd/dist/worker.mjs", ".opencode/tasks/worker.mjs")

console.log("Local plugin bundle: .opencode/plugins/tasks.js")
