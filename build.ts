import { cp, mkdir, rm } from "node:fs/promises"

await rm("dist", { recursive: true, force: true })
await mkdir("dist", { recursive: true })

for (const entrypoint of [
  "src/index.ts",
  "src/worker.ts",
] as const) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: "dist",
    target: "bun",
    compile: false,
    external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
    format: "esm",
    minify: true,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}

await cp("src/skills", "dist/skills", { recursive: true })
