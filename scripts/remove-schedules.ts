import { uninstallTaskWorker } from "../src/tasks-scheduler"
import { readState, writeState } from "../src/state"

const dir = process.cwd()
const state = readState(dir)
const slugs = Object.keys(state.schedulers)

for (const slug of slugs) {
  console.log(`Removing scheduler: ${slug || "(board)"}`)
  await uninstallTaskWorker(dir, slug)
}

state.schedulers = {}
writeState(dir, state)

console.log(slugs.length ? "All schedulers removed." : "No schedulers found.")
