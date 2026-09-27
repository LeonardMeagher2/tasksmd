import { existsSync, statSync } from "node:fs"
import path from "node:path"

import { watch } from "chokidar"
import globParent from "glob-parent"
import picomatch from "picomatch"

import type { WatchConfig } from "./config"
import { log } from "./worker/common"

/**
 * Coalesce a burst of changes into one fire. A build writing many files should
 * wake the task once, not once per file.
 */
const WATCH_DEBOUNCE_MS = 5000

function globPath(value: string): string {
  return path.sep === "\\" ? value.replace(/\\/g, "/") : value
}

/**
 * Turn a declared pattern into a matchable glob. A pattern naming a directory —
 * by trailing slash or by resolving to one — means "its contents".
 */
function toGlob(directory: string, pattern: string): string {
  const resolved = path.resolve(directory, pattern)
  const glob = globPath(resolved)
  if (/[\\/]$/.test(pattern)) return `${glob}/**`
  if (existsSync(resolved) && statSync(resolved).isDirectory()) return `${glob}/**`
  return glob
}

/** Find the nearest existing ancestor directory for a possibly missing glob root. */
function existingWatchRoot(directory: string, glob: string): string | undefined {
  const projectRoot = path.resolve(directory)
  let candidate = path.resolve(directory, globParent(glob))

  while (!existsSync(candidate)) {
    const parent = path.dirname(candidate)
    if (candidate === projectRoot || parent === candidate) return undefined
    candidate = parent
  }

  try {
    return statSync(candidate).isDirectory() ? candidate : path.dirname(candidate)
  } catch {
    return undefined
  }
}

/**
 * Watch a set of globs under `directory` and call `onFire` (debounced) when a
 * matching path changes. Returns a function that closes the watcher, or
 * `undefined` when the project root itself does not exist.
 *
 * chokidar v5 dropped glob support, so each glob is watched at its literal base
 * (via `glob-parent`) and the glob itself is applied to each changed path. A
 * pattern matching a directory watches its contents, one matching files watches
 * those files — both through the same setting.
 */
export function startWatcher(
  directory: string,
  slug: string,
  config: WatchConfig,
  onFire: () => void,
): (() => void) | undefined {
  if (!config.paths.length) return undefined

  const globs = config.paths.flatMap((p) => {
    const glob = toGlob(directory, p)
    // A glob-free pattern may name a file or a directory — including one that
    // does not exist yet — so match the path itself and its possible contents.
    return /[*?[\]{}]/.test(glob) ? [glob] : [glob, `${glob}/**`]
  })
  const matches = picomatch(globs, { dot: true })
  const ignoreGlobs = config.ignore.flatMap((pattern) => {
    // Leading `**/` defaults apply to watched paths anywhere, while other
    // relative ignores are scoped to the project root like watch paths.
    const glob = pattern.startsWith("**/") || path.isAbsolute(pattern)
      ? globPath(pattern.replace(/[\\/]$/, ""))
      : globPath(path.resolve(directory, pattern.replace(/[\\/]$/, "")))
    const withContents = /[\\/]$/.test(pattern) ? `${glob}/**` : glob
    if (withContents.endsWith("/**")) return [withContents.slice(0, -3), withContents]
    return /[*?[\]{}]/.test(withContents) ? [withContents] : [withContents, `${withContents}/**`]
  })
  const isIgnored = picomatch(ignoreGlobs, { dot: true })
  const roots = [...new Set(globs.map((g) => existingWatchRoot(directory, g)).filter((r): r is string => Boolean(r)))]
  if (!roots.length) {
    log(directory, `task=${slug} action=watch-skip reason=no-existing-roots`)
    return undefined
  }

  const watcher = watch(roots, {
    ignoreInitial: true,
    ignored: (candidate: string) => {
      const absolute = globPath(path.resolve(candidate))
      return isIgnored(absolute)
    },
    // The watcher is a background trigger, not a reason to keep the host alive.
    persistent: false,
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = (changed: string) => {
    // Match absolute paths so `../shared/**` and absolute globs work too.
    const absolute = globPath(path.resolve(changed))
    if (!matches(absolute)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      log(directory, `task=${slug} action=watch-fire file=${absolute}`)
      onFire()
    }, WATCH_DEBOUNCE_MS)
    timer.unref?.()
  }

  watcher.on("add", fire)
  watcher.on("change", fire)
  watcher.on("unlink", fire)
  watcher.on("addDir", fire)
  watcher.on("unlinkDir", fire)
  watcher.on("error", (error) => {
    log(directory, `task=${slug} action=watch-error reason=${error instanceof Error ? error.message : String(error)}`)
  })

  return () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    void watcher.close()
  }
}
