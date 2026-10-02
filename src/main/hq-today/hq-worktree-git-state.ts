// Custom build (hq-screen): uncommitted changes and unpushed commits of a few local workspaces, for
// HQ's deferred sessions — one `git status` each, cached briefly so the list can poll.
import type { HqWorktreeGitState, HqWorktreeGitStates } from '../../shared/hq-project-pages'

const CACHE_MS = 60_000
const MAX_PATHS = 40

/** `git status --porcelain -b`: the `## branch...upstream [ahead N]` line, then one line per change. */
export function readHqWorktreeGitState(stdout: string): HqWorktreeGitState {
  const lines = stdout.split('\n').filter((line) => line.trim())
  const header = lines[0]?.startsWith('## ') ? lines[0] : ''
  const ahead = /\[(?:[^\]]*\s)?ahead (\d+)/.exec(header)
  return {
    changes: lines.filter((line) => !line.startsWith('## ')).length,
    ahead: ahead ? Number(ahead[1]) : 0
  }
}

export type HqWorktreeGitStateReader = (paths: readonly string[]) => Promise<HqWorktreeGitStates>

export function createHqWorktreeGitStateReader(deps: {
  status: (path: string) => Promise<string>
  now: () => number
}): HqWorktreeGitStateReader {
  const cache = new Map<string, { at: number; state: Promise<HqWorktreeGitState | null> }>()
  return async (paths) => {
    const unique = [...new Set(paths)].slice(0, MAX_PATHS)
    const entries = await Promise.all(
      unique.map(async (path) => {
        let hit = cache.get(path)
        if (!hit || deps.now() - hit.at > CACHE_MS) {
          hit = {
            at: deps.now(),
            state: deps
              .status(path)
              .then(readHqWorktreeGitState)
              .catch(() => null)
          }
          cache.set(path, hit)
        }
        return [path, await hit.state] as const
      })
    )
    return Object.fromEntries(entries)
  }
}
