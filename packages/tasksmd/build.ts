import { rm } from "node:fs/promises"

await rm("dist", { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  compile: false,
  external: ["deepmerge", "yaml"],
  format: "esm",
  minify: true,
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// Bun does not emit declarations, so consumers would see `any` without this.
const types = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], { stdio: ["ignore", "inherit", "inherit"] })
if (types.exitCode !== 0) process.exit(types.exitCode ?? 1)
