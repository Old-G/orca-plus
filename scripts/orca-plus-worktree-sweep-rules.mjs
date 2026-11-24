// Custom build (worktree-sweep): the pure rules of scripts/orca-plus-worktree-sweep.mjs — what keeps a
// worktree, how its branch is kept, what counts as a cache, and the parsers for git and lsof output.
import { createHash } from 'node:crypto'
import { basename, sep } from 'node:path'

export const BACKUP_REF_PREFIX = 'refs/orca-plus-sweep/'
export const BACKUP_KEEP_DAYS = 30
export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
// Why: a short subject such as «wip» or «fix tests» names nothing; only a descriptive one proves a commit.
const MIN_TRUSTED_SUBJECT = 20

/** Parses `git worktree list --porcelain`. */
export function parseWorktreePorcelain(text) {
  const entries = []
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = {
        path: line.slice(9),
        head: null,
        branch: null,
        detached: false,
        locked: false,
        prunable: false,
        bare: false
      }
      entries.push(current)
    } else if (!current) {
      continue
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    } else if (line === 'detached') {
      current.detached = true
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = true
    }
  }
  return entries
}

/** «fixup! squash! X» → «X»: a fixup squashed into X during a rebase lands as X. */
export function normalizeSubject(subject) {
  let s = subject.trim()
  while (/^(fixup|squash|amend)! /.test(s)) {
    s = s.replace(/^(fixup|squash|amend)! /, '').trim()
  }
  return s
}

export function isTrustedSubject(subject) {
  return normalizeSubject(subject).length >= MIN_TRUSTED_SUBJECT
}

/** Every commit subject is in the base by name (after a rebase or a squash of fixups). */
export function subjectsLanded(ownSubjects, baseSubjects) {
  if (ownSubjects.length === 0) {
    return false
  }
  const base = new Set(baseSubjects.map(normalizeSubject))
  return ownSubjects.every((s) => isTrustedSubject(s) && base.has(normalizeSubject(s)))
}

/**
 * The verdict for one worktree. `ev` is the gathered evidence; returns the reasons it stays (empty =
 * it goes). Pure, so the rules are tested without git.
 */
export function keepReasons(ev) {
  const reasons = []
  if (ev.isMain) {
    reasons.push('main checkout')
  }
  if (ev.bare) {
    reasons.push('bare')
  }
  if (!ev.underRoot) {
    reasons.push(OUTSIDE_ROOT)
  }
  if (ev.locked) {
    reasons.push('locked')
  }
  if (ev.pinned) {
    reasons.push('pinned in Orca')
  }
  if (ev.orcaUnread) {
    reasons.push('Orca did not report its agents')
  }
  if (ev.liveAgent) {
    reasons.push('an agent is still working')
  }
  if (ev.liveTerminal) {
    reasons.push('a terminal is live')
  }
  if (ev.onScreen) {
    reasons.push('open on screen in Orca')
  }
  if (ev.liveProcess) {
    reasons.push(`a process works in it: ${ev.liveProcess}`)
  }
  if (ev.processesUnread) {
    reasons.push('running processes unread (lsof)')
  }
  if (ev.idleMs !== null && ev.idleMs < ev.minIdleMs) {
    reasons.push(`active ${Math.round(ev.idleMs / HOUR_MS)} h ago`)
  }
  // Why: the git checks run only once nothing above keeps it, so they speak only after that.
  if (reasons.length > 0) {
    return reasons
  }
  if (ev.dirtyCount === null) {
    reasons.push('git status unreadable')
  } else if (ev.dirtyCount > 0) {
    reasons.push(`${ev.dirtyCount} uncommitted file(s)`)
  } else if (!ev.landedIn) {
    reasons.push('has work not in the base branch')
  } else if (ev.copyTooBig) {
    reasons.push(`${ev.copyTooBig} of ignored files beyond caches — too big to keep a copy`)
  }
  return reasons
}

export const OUTSIDE_ROOT = 'outside --root'

/** `YYYYMMDD` of a backup ref, or null. */
export function backupRefDay(ref) {
  const m = new RegExp(`^${BACKUP_REF_PREFIX}(\\d{8})/`).exec(ref)
  return m ? m[1] : null
}

export function isBackupExpired(ref, now) {
  const day = backupRefDay(ref)
  if (!day) {
    return false
  }
  const at = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)))
  return now - at > BACKUP_KEEP_DAYS * 24 * HOUR_MS
}

/**
 * Where a removed worktree's tip is kept. The tip's sha in the name keeps two removals of one branch on
 * the same day apart (Codex P2 10.11). The branch is one path component (`/` → `%2F`, `%` → `%25`), so no
 * backup ref is ever the folder of another — `feat/x` at `aaaa…` next to `feat/x-aaaa…/y` (Codex P2 10.11).
 */
export function backupRefName(day, name, head) {
  const flat = String(name).replaceAll('%', '%25').replaceAll('/', '%2F')
  return `${BACKUP_REF_PREFIX}${day}/${boundedComponent(flat)}-${String(head).slice(0, 12)}`
}

// Why: the flat branch is one file name; git adds `-<sha12>` and `.lock`, and file systems stop at 255
// bytes, so a long nested branch would fail `update-ref` and its worktree would never go (Codex P2 11.11).
const BACKUP_FLAT_MAX_BYTES = 200

/**
 * The flat branch, or its start plus `%h<hash of the whole name>` when it is too long. `%h` never occurs in
 * a flat name (every `%` there is `%25` or `%2F`), so a shortened name cannot equal a short branch's backup.
 * The cut falls on a whole character and never inside a `%XX` escape; the log keeps the full branch name.
 */
function boundedComponent(flat) {
  if (Buffer.byteLength(flat) <= BACKUP_FLAT_MAX_BYTES) {
    return flat
  }
  const tail = `%h${createHash('sha1').update(flat).digest('hex').slice(0, 12)}`
  const budget = BACKUP_FLAT_MAX_BYTES - tail.length
  let kept = ''
  let bytes = 0
  for (const piece of flat.match(/%[0-9A-F]{2}|[^]/gu)) {
    const size = Buffer.byteLength(piece)
    if (bytes + size > budget) {
      break
    }
    kept += piece
    bytes += size
  }
  return `${kept}${tail}`
}

export function dayStamp(now) {
  const d = new Date(now)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// Why: rebuilt by an install or a build, so a removal loses nothing by not copying them.
export const CACHE_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.turbo',
  '.vite',
  '.cache',
  '.parcel-cache',
  '.gradle',
  '.eslintcache',
  'dist',
  'build',
  'out-tsc',
  'coverage',
  'target',
  '.DS_Store'
])
export const CACHE_SUFFIXES = ['.pyc', '.egg-info', '.tsbuildinfo']

export function isCacheName(name) {
  return CACHE_NAMES.has(name) || CACHE_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/** `git status --porcelain -z --ignored`: changed paths, and ignored ones that are not caches. */
export function parseStatusZ(text) {
  const dirty = []
  const ignored = []
  const parts = text.split('\0')
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (entry.length < 4) {
      continue
    }
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (code === '!!') {
      if (!isCacheName(basename(path))) {
        ignored.push(path)
      }
    } else {
      dirty.push(path)
      // A rename or copy carries its old path as the next field.
      if (code[0] === 'R' || code[0] === 'C') {
        i += 1
      }
    }
  }
  return { dirty, ignored }
}

/** `lsof -F pcn -d cwd`: each process with its working folder. */
export function parseLsofCwd(text) {
  const procs = []
  let current = null
  for (const line of text.split('\n')) {
    const value = line.slice(1)
    if (line[0] === 'p') {
      current = { pid: Number(value), cmd: '', cwd: null }
      procs.push(current)
    } else if (current && line[0] === 'c') {
      current.cmd = value
    } else if (current && line[0] === 'n') {
      current.cwd = value
    }
  }
  return procs.filter((proc) => proc.cwd)
}

// Why: Orca polls `git status` in every worktree, and this sweep runs git and lsof there itself.
const PASSING_PROCESSES = new Set(['git', 'lsof'])

/** The first process (not a passing git) whose working folder is the worktree or inside it. */
export function processInside(procs, path, selfPid = process.pid) {
  const hit = procs.find(
    (proc) =>
      proc.pid !== selfPid &&
      !PASSING_PROCESSES.has(proc.cmd) &&
      (proc.cwd === path || proc.cwd.startsWith(path + sep))
  )
  return hit ? `${hit.cmd} (pid ${hit.pid})` : null
}

/** One file name for a worktree's copy of ignored files: `<repo>--<folder>-<sha12>.tar.gz`. */
export function copyFileName(repo, path, head) {
  const safe = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, '_')
  return `${safe(repo)}--${safe(basename(path))}-${String(head).slice(0, 12)}.tar.gz`
}

export function formatBytes(bytes) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

/** The commit a worktree was created at: the new side of the first line of its HEAD reflog. */
export function firstReflogCommit(text) {
  const m = /^[0-9a-f]{40,64} ([0-9a-f]{40,64}) /.exec(text)
  return m ? m[1] : null
}

/** Time of the newest entry in a reflog's text (`<old> <new> <who> <unix-seconds> <tz>\t<what>`), in ms. */
export function lastReflogAt(text) {
  const lines = text.trimEnd().split('\n')
  const m = /\s(\d{9,})\s[+-]\d{4}\t/.exec(lines.at(-1) ?? '')
  return m ? Number(m[1]) * 1000 : 0
}
