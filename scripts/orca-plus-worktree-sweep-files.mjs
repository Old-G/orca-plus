// Custom build (worktree-sweep): a worktree's own files for scripts/orca-plus-worktree-sweep.mjs — which
// ignored files a removal copies (caches left out), the copy checked against that list, a checkout nested
// inside, and tracked files `git status` cannot see (assume-unchanged, skip-worktree).
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  copyFileName,
  dayStamp,
  isRegenerableName,
  missingFromListing,
  parseHiddenTracked,
  parseStatusZ
} from './orca-plus-worktree-sweep-rules.mjs'
import { gitRaw, run } from './orca-plus-worktree-sweep-git.mjs'

// Why: a copy of hundreds of thousands of files is a cache nobody named; it stays, the report says why.
export const MAX_COPY_FILES = 100_000

/**
 * Every ignored path a removal copies: the entries `git status --ignored` lists and, below a listed
 * folder, everything but regenerable caches (node_modules, .venv…). A cache name is skipped only below a
 * listed entry, never for the entry itself: `build/export.csv` that git lists keeps its place although
 * `build` is a cache name, and so does `state/build/export.csv` (Codex P1 24.11). `sig` (path, size, mtime
 * of each) tells whether anything changed between two walks; `nested` is the first folder with a `.git` in
 * it — another checkout a removal would take along; `caches` are the skipped folders. A path the walk
 * cannot read back exactly (gone, not UTF-8, a newline in it) is `unreadable`: its copy could not be checked.
 */
export function ignoredManifest(wtPath, entries, maxBytes, maxFiles = MAX_COPY_FILES) {
  const out = {
    paths: [],
    bytes: 0,
    over: false,
    nested: null,
    unreadable: null,
    caches: [],
    sig: ''
  }
  const sig = []
  const stack = entries.map((entry) => entry.replace(/\/+$/, '')).toReversed()
  while (stack.length > 0 && !out.over) {
    const rel = stack.pop()
    // Why: tar lists one name a line, so a name with a newline could not be checked in the copy.
    if (rel.includes('\n')) {
      out.unreadable ??= JSON.stringify(rel)
      continue
    }
    let info
    try {
      info = lstatSync(join(wtPath, rel))
    } catch {
      // Git listed it and it is not there under that spelling: gone this moment, or named otherwise.
      out.unreadable ??= rel
      continue
    }
    if (info.isDirectory()) {
      let raw
      try {
        raw = readdirSync(join(wtPath, rel), { encoding: 'buffer' })
      } catch {
        out.unreadable ??= rel
        continue
      }
      out.paths.push(rel)
      sig.push(`${rel}/`)
      const children = []
      for (const bytes of raw) {
        const name = bytes.toString('utf8')
        // Why: a name that is not UTF-8 reads back as another spelling and would be left out (Codex P1 24.11).
        if (Buffer.from(name).equals(bytes)) {
          children.push(name)
        } else {
          out.unreadable ??= `${rel}/<a name that is not UTF-8>`
        }
      }
      if (children.includes('.git')) {
        out.nested ??= rel
      }
      for (const child of children.sort().toReversed()) {
        const into = isRegenerableName(child) ? out.caches : stack
        into.push(`${rel}/${child}`)
      }
    } else if (info.isFile() || info.isSymbolicLink()) {
      out.paths.push(rel)
      out.bytes += info.size
      sig.push(`${rel}\t${info.size}\t${info.mtimeMs}`)
    }
    // Sockets and pipes live only while their process runs; there is nothing in them to copy.
    // Why after each path: the last one counts toward the limit too (Codex P2 24.11).
    out.over = out.bytes > maxBytes || out.paths.length > maxFiles
  }
  out.sig = sig.join('\n')
  return out
}

/**
 * The first `.git` inside cache folders a removal does not copy — a clone kept in `state/node_modules`, say
 * (Codex P1 24.11). `{ nested }` relative to the worktree, or `{ unreadable: true }` when find did not finish.
 */
export function checkoutInCaches(wtPath, caches) {
  const dirs = caches
    .map((rel) => join(wtPath, rel.replace(/\/+$/, '')))
    .filter((path) => {
      try {
        return lstatSync(path).isDirectory()
      } catch {
        return false
      }
    })
  if (dirs.length === 0) {
    return { nested: null, unreadable: false }
  }
  // Why -print0: a folder name with a newline would cut the hit short and lose it (Codex P1 24.11).
  const found = run('find', [...dirs, '-name', '.git', '-print0', '-quit'], {
    timeout: 120_000,
    killSignal: 'SIGKILL',
    raw: true
  })
  const hit = found.out.split('\0')[0]
  if (hit) {
    return { nested: relative(wtPath, dirname(hit)) || '.', unreadable: false }
  }
  return { nested: null, unreadable: !found.ok }
}

/**
 * The ignored files of a worktree as a removal sees them: the manifest, and — `deep` — a look for a
 * checkout inside the caches it skips. Over the limit, unreadable or holding a checkout: it stays.
 */
export function inspectIgnored(wtPath, status, maxBytes, { deep }) {
  const manifest = ignoredManifest(wtPath, status.ignored, maxBytes)
  if (deep && !manifest.over && !manifest.nested && !manifest.unreadable) {
    const inCaches = checkoutInCaches(wtPath, [...status.caches, ...manifest.caches])
    manifest.nested = inCaches.nested
    manifest.unreadable = inCaches.unreadable ? 'its cache folders (find did not finish)' : null
  }
  return manifest
}

/**
 * Holds `<attic>/locks/<path hash>.lock` while one sweep removes the checkout, so a night run and a chat
 * close never work on it at once and undo each other's backup (Codex P1 24.11). A lock whose process is
 * gone is taken over. Returns the release, or null when another sweep holds it.
 */
export function lockCheckout(attic, wtPath) {
  const dir = join(attic, 'locks')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${createHash('sha1').update(wtPath).digest('hex').slice(0, 16)}.lock`)
  // Why linked in from a file of its own: the lock appears with its pid already in it.
  const own = `${file}.${process.pid}`
  writeFileSync(own, `${process.pid}\n`, { mode: 0o600 })
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        linkSync(own, file)
        return () => rmSync(file, { force: true })
      } catch (error) {
        if (error.code !== 'EEXIST' || !takeStale(file)) {
          return null
        }
      }
    }
    return null
  } finally {
    rmSync(own, { force: true })
  }
}

/**
 * Moves a lock whose process is gone out of the way. Two sweeps can find the same dead lock, and the second
 * must not delete the one the first has just taken (Codex P1 24.11, third review): the lock is moved aside
 * and read back, and one that is no longer the dead one is put back. False when it is live or taken.
 */
function takeStale(file) {
  const pid = lockPid(file)
  if (pid === null || processAlive(pid)) {
    return false
  }
  const aside = `${file}.${process.pid}.stale`
  try {
    renameSync(file, aside)
  } catch {
    return false
  }
  const same = lockPid(aside) === pid
  if (!same) {
    try {
      linkSync(aside, file)
    } catch {
      // A third sweep took the lock meanwhile; it holds it and this one steps back.
    }
  }
  rmSync(aside, { force: true })
  return same
}

/** The pid a lock names (0 when it names none), or null when it cannot be read — gone this moment. */
function lockPid(lockFile) {
  try {
    const pid = Number.parseInt(readFileSync(lockFile, 'utf8'), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  } catch {
    return null
  }
}

function processAlive(pid) {
  if (pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** `git status` of the worktree: changed paths, ignored ones beyond caches, the caches; null when unread. */
export function readStatus(wtPath) {
  const status = gitRaw(
    wtPath,
    'status',
    '--porcelain',
    '-z',
    '--ignored=traditional',
    '--untracked-files=normal'
  )
  return status.ok ? parseStatusZ(status.out) : null
}

/**
 * Tracked files git hides from its own clean check (assume-unchanged, skip-worktree): an edit there shows
 * in no `git status` and is lost with the folder (Codex P1 24.11). Null when the index cannot be read.
 */
export function hiddenTracked(wtPath) {
  const listed = gitRaw(wtPath, 'ls-files', '-v', '-z')
  return listed.ok ? parseHiddenTracked(listed.out) : null
}

/**
 * Copies the manifest's paths to `<attic>/<YYYYMMDD>/…tar.gz` and checks the copy lists every one of
 * them before it counts. The name carries a hash of the worktree's full path, and a second removal of the
 * same path and tip the same day gets its own name: the copy is linked in, which never replaces a file
 * there, so no copy ever replaces another, not even one a sweep running alongside just wrote (Codex P1 24.11).
 */
export function archiveManifest({ repo, wtPath, head, paths, now, attic }) {
  if (paths.length === 0) {
    return { ok: true, copy: null }
  }
  const dir = join(attic, dayStamp(now))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const name = join(dir, copyFileName(repo, wtPath, head))
  const part = `${name}.${now}-${process.pid}.part`
  // Why --no-recursion: the manifest already names every path, so a folder brings no cache along.
  const packed = run('tar', ['-czf', part, '-C', wtPath, '--no-recursion', '--null', '-T', '-'], {
    input: `${paths.join('\0')}\0`,
    timeout: 600_000,
    killSignal: 'SIGKILL'
  })
  if (!packed.ok || !existsSync(part)) {
    rmSync(part, { force: true })
    return { ok: false, err: packed.err || 'no archive written' }
  }
  // Why: run state and .env copies can hold secrets; the copy is the owner's alone.
  chmodSync(part, 0o600)
  const listed = run('tar', ['-tzf', part], { timeout: 600_000, killSignal: 'SIGKILL', raw: true })
  const missing = listed.ok ? missingFromListing(paths, listed.out) : paths
  if (missing.length > 0) {
    rmSync(part, { force: true })
    return { ok: false, err: `the copy lacks ${missing.length} file(s), first ${missing[0]}` }
  }
  for (const copy of [name, name.replace(/\.tar\.gz$/, `-${now}-${process.pid}.tar.gz`)]) {
    try {
      linkSync(part, copy)
      rmSync(part, { force: true })
      return { ok: true, copy }
    } catch (error) {
      if (error.code !== 'EEXIST') {
        rmSync(part, { force: true })
        return { ok: false, err: String(error.message) }
      }
    }
  }
  rmSync(part, { force: true })
  return { ok: false, err: 'copies by both names are there already' }
}
