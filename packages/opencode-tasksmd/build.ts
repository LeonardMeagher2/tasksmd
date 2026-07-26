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

// The debug CLI script is a standalone diagnostic tool and must be
// self-contained.
const debugCli = await Bun.build({
  entrypoints: ["src/debug-cli.ts"],
  outdir: "dist",
  target: "node",
  compile: false,
  naming: "debug-cli.mjs",
  format: "esm",
  minify: true,
})
if (!debugCli.success) {
  for (const log of debugCli.logs) console.error(log)
  process.exit(1)
}
