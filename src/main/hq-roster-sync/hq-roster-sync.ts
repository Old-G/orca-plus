// Custom build (hq-roster-sync): a project added to or removed from Orca reaches the HQ meta-wiki.
// HQ's own scripts do the work — hq_registry.py rebuilds registry.yaml from `orca repo list` and
// moves a removed project's page to projects/_archive/, hq_sync.py creates the new page — so Orca
// only decides when to run them and commits the result.
import { join } from 'node:path'

export type HqCommandResult = { code: number | null; stdout: string; stderr: string }

export type HqRosterSyncDeps = {
  hqPath: () => string | null
  fileExists: (path: string) => boolean
  run: (program: string, args: readonly string[], cwd: string) => Promise<HqCommandResult>
  platform: NodeJS.Platform
  log: (message: string) => void
  debounceMs?: number
}

export type HqRosterSyncOutcome =
  | 'off'
  | 'no-scripts'
  | 'failed'
  | 'unchanged'
  | 'committed'
  | 'left-uncommitted'

type RegistryReport = { added: string[]; removed: string[]; changed: boolean }

// Why 3 s: a nested-repo import adds several projects in a row; one sync covers them all.
const DEFAULT_DEBOUNCE_MS = 3_000

function readRegistryReport(stdout: string): RegistryReport | null {
  const line = stdout.trim().split('\n').pop()
  if (!line) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const names = (key: string): string[] => {
      const value: unknown = Reflect.get(parsed, key)
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    }
    return {
      added: names('added'),
      removed: names('removed'),
      changed: Reflect.get(parsed, 'changed') === true
    }
  } catch {
    return null
  }
}

export function hqRosterCommitMessage(report: RegistryReport): string {
  const parts = [
    report.added.length > 0 ? `added ${report.added.join(', ')}` : null,
    report.removed.length > 0 ? `archived ${report.removed.join(', ')}` : null
  ].filter((part): part is string => part !== null)
  return `chore(registry): Orca projects ${parts.join('; ') || 'changed'}`
}

export function createHqRosterSync(deps: HqRosterSyncDeps) {
  const python = deps.platform === 'win32' ? 'python' : 'python3'
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<HqRosterSyncOutcome> | null = null
  let rerun = false

  const runOnce = async (): Promise<HqRosterSyncOutcome> => {
    const hq = deps.hqPath()?.trim()
    if (!hq) {
      return 'off'
    }
    const registryScript = join(hq, 'scripts', 'hq_registry.py')
    const syncScript = join(hq, 'scripts', 'hq_sync.py')
    if (!deps.fileExists(registryScript) || !deps.fileExists(syncScript)) {
      deps.log(`${hq} has no HQ scripts; skipped`)
      return 'no-scripts'
    }
    // Why: commit only when HQ was clean, so the commit never sweeps up the owner's own edits.
    const status = await deps.run('git', ['status', '--porcelain'], hq)
    const committable = status.code === 0 && status.stdout.trim() === ''

    const registry = await deps.run(python, [registryScript, '--hq', hq], hq)
    const report = registry.code === 0 ? readRegistryReport(registry.stdout) : null
    if (!report) {
      // Exit 2 = the project list could not be read; the script already kept registry.yaml.
      deps.log(`hq_registry.py exited ${registry.code}: ${registry.stderr.trim()}`)
      return 'failed'
    }
    if (!report.changed) {
      return 'unchanged'
    }
    const sync = await deps.run(python, [syncScript, '--hq', hq], hq)
    if (sync.code !== 0) {
      deps.log(`hq_sync.py exited ${sync.code}: ${sync.stderr.trim()}`)
      return 'failed'
    }
    if (!committable) {
      deps.log(
        status.code === 0
          ? 'HQ had uncommitted changes; registry updated but not committed'
          : 'HQ is not a git repo; registry updated'
      )
      return 'left-uncommitted'
    }
    const add = await deps.run('git', ['add', '-A'], hq)
    const commit =
      add.code === 0
        ? await deps.run('git', ['commit', '-q', '-m', hqRosterCommitMessage(report)], hq)
        : add
    if (commit.code !== 0) {
      deps.log(`HQ commit failed: ${commit.stderr.trim()}`)
      return 'left-uncommitted'
    }
    deps.log(hqRosterCommitMessage(report))
    return 'committed'
  }

  const drain = async (): Promise<HqRosterSyncOutcome> => {
    let outcome: HqRosterSyncOutcome
    do {
      rerun = false
      outcome = await runOnce().catch((error: unknown) => {
        deps.log(`sync failed: ${String(error)}`)
        return 'failed' as const
      })
    } while (rerun)
    return outcome
  }

  return {
    /** A project was added or removed; sync once the burst settles. */
    schedule(): void {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        if (running) {
          // Why: the running pass may have read the project list before this change.
          rerun = true
          return
        }
        running = drain().finally(() => {
          running = null
        })
      }, deps.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    },

    /** Sync now, sharing a pass already running — for callers that need group names fresh. */
    syncNow(): Promise<HqRosterSyncOutcome> {
      if (running) {
        rerun = true
        return running
      }
      running = drain().finally(() => {
        running = null
      })
      return running
    },

    /** Resolves when no sync is pending or running (tests). */
    async idle(): Promise<HqRosterSyncOutcome | null> {
      return running ? running : null
    },

    runOnce: drain,

    dispose(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}

export type HqRosterSync = ReturnType<typeof createHqRosterSync>
