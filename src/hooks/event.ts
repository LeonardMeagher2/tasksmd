import { tryRunTask } from "../tasks-runtime"

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function createEventHook(directory: string, schedulerEnabled: boolean) {
  return {
    event: async ({ event }: { event: any }) => {
      if (event.type !== "file.edited" && event.type !== "file.watcher.updated") return

      if (!schedulerEnabled) return

      const existing = debounceTimers.get(directory)
      if (existing) clearTimeout(existing)

      debounceTimers.set(
        directory,
        setTimeout(async () => {
          debounceTimers.delete(directory)
          try {
            await tryRunTask(null, directory)
          } catch {
            tryRunTask(null, directory)
          }
        }, 5000),
      )
    },
  }
}
