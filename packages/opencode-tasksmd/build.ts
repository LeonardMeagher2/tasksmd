import { mkdir, rm } from "node:fs/promises"

await rm("dist", { recursive: true, force: true })
await mkdir("dist", { recursive: true })

// The plugin entry runs inside OpenCode's plugin loader, which provides the
// SDK and installs package dependencies — keep them external.
const plugin = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  compile: false,
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "@leonardmeagher2/tasksmd", "parse-duration-ms"],
  format: "esm",
  minify: true,
})
if (!plugin.success) {
  for (const log of plugin.logs) console.error(log)
  process.exit(1)
}

// The worker is copied standalone into a project's .opencode/tasks/ directory
// where no node_modules exist — it must be fully self-contained. It runs
// under bun (CLI hosts) and plain Node/Electron (desktop hosts), so build for
// the lowest common denominator: node.
const worker = await Bun.build({
  entrypoints: ["src/worker.ts"],
  outdir: "dist",
  target: "node",
  compile: false,
  naming: "worker.mjs",
  format: "esm",
  minify: true,
})
if (!worker.success) {
  for (const log of worker.logs) console.error(log)
  process.exit(1)
}
