// Custom build (C5): what a ship carries besides your own change. `merge-slot take|status` lists the
// commits already on the target that the last ship did not include — they leave with your merge.
// The last shipped commit is `git config orca.shipped` (scripts/orca-plus-ship.sh writes it after a
// verified ship); a project that ships otherwise sets it the same way. Read-only: nothing here
// writes to git.
import { execFileSync } from 'node:child_process'

export type ShipCommit = { sha: string; author: string; subject: string }

export type ShipRange =
  | { ok: true; since: string; target: string; commits: ShipCommit[] }
  | { ok: false; reason: string }

/** Why a unit separator: a subject may hold any printable character. */
const FIELD = '\u001f'
export const SHIP_LOG_FORMAT = `%h${FIELD}%an${FIELD}%s`

export function parseShipLog(raw: string): ShipCommit[] {
  return raw
    .split('\n')
    .filter((row) => row.length > 0)
    .map((row) => {
      const [sha = '', author = '', ...subject] = row.split(FIELD)
      return { sha, author, subject: subject.join(FIELD) }
    })
}

type Git = (args: string[]) => string

function gitIn(cwd: string): Git {
  return (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryGit(git: Git, args: string[]): string | null {
  try {
    return git(args) || null
  } catch {
    return null
  }
}

/**
 * Commits in `since..target`, oldest first. `since` defaults to `orca.shipped`, `target` to
 * `orca.shipTarget`, then `origin/HEAD`. A missing piece is a reason, never a throw: this is advice
 * printed next to the slot and must not stop a merge.
 */
export function readShipRange(
  cwd: string,
  opts: { since?: string; target?: string },
  git: Git = gitIn(cwd)
): ShipRange {
  const since = opts.since ?? tryGit(git, ['config', '--get', 'orca.shipped'])
  if (!since) {
    return {
      ok: false,
      reason: 'no last-shipped commit (git config orca.shipped, or --since <ref>)'
    }
  }
  const target =
    opts.target ??
    tryGit(git, ['config', '--get', 'orca.shipTarget']) ??
    tryGit(git, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
  if (!target) {
    return { ok: false, reason: 'no target branch (git config orca.shipTarget, or --target <ref>)' }
  }
  let log: string
  try {
    log = git(['log', '--reverse', `--format=${SHIP_LOG_FORMAT}`, `${since}..${target}`])
  } catch {
    const known = tryGit(git, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`]) !== null
    return {
      ok: false,
      reason: known ? `${target} is not a ref here` : `${since} is not a commit here`
    }
  }
  return { ok: true, since, target, commits: parseShipLog(log) }
}

const SHOWN = 15

export function formatShipRange(range: ShipRange): string {
  if (!range.ok) {
    return `Others' commits in the next ship: unknown — ${range.reason}.`
  }
  if (range.commits.length === 0) {
    return `Others' commits in the next ship: none (${range.target} is at the last ship).`
  }
  const rows = range.commits.slice(0, SHOWN).map((c) => `  ${c.sha} ${c.author} — ${c.subject}`)
  const more = range.commits.length - rows.length
  return [
    `Others' commits that ship with yours (${range.since}..${range.target}, ${range.commits.length}):`,
    ...rows,
    ...(more > 0 ? [`  … and ${more} more`] : []),
    'Ship only if the owner knows about them; otherwise ask the lead first.'
  ].join('\n')
}
