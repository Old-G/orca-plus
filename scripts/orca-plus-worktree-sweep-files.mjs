// Custom build (worktree-sweep): a worktree's own files for scripts/orca-plus-worktree-sweep.mjs — which
// ignored files a removal copies (caches left out), the copy checked against that list, a checkout nested
// inside, and tracked files `git status` cannot see (assume-unchanged, skip-worktree).
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import {
  copyFileName,
  dayStamp,
  isCacheName,
  missingFromListing,
  parseHiddenTracked,
  parseStatusZ
} from './orca-plus-worktree-sweep-rules.mjs'
import { gitRaw, run } from './orca-plus-worktree-sweep-git.mjs'

// Why: a copy of hundreds of thousands of files is a cache nobody named; it stays, the report says why.
export const MAX_COPY_FILES = 100_000

/**
 * Every ignored path a removal copies: the entries `git status --ignored` lists and, below a listed
 * folder, everything but caches. A cache name is skipped only below a listed entry, never for the entry
 * itself: `build/export.csv` that git lists keeps its place although `build` is a cache name (Codex P1
 * 24.11). `sig` (path, size, mtime of each) tells whether anything changed between two walks; `nested`
 * is the first folder with a `.git` in it — another checkout a removal would take along (Codex P1 24.11).
 */
export function ignoredManifest(wtPath, entries, maxBytes, maxFiles = MAX_COPY_FILES) {
  const out = { paths: [], bytes: 0, over: false, nested: null, unreadable: null, sig: '' }
  const sig = []
  const stack = entries.map((entry) => entry.replace(/\/+$/, '')).toReversed()
  while (stack.length > 0) {
    if (out.bytes > maxBytes || out.paths.length > maxFiles) {
      out.over = true
      break
    }
    const rel = stack.pop()
    let info
    try {
      info = lstatSync(join(wtPath, rel))
    } catch {
      // Gone between git's listing and the walk: nothing left to copy.
      continue
    }
    if (info.isDirectory()) {
      let children
      try {
        children = readdirSync(join(wtPath, rel)).sort()
      } catch {
        out.unreadable ??= rel
        continue
      }
      if (children.includes('.git')) {
        out.nested ??= rel
      }
      out.paths.push(rel)
      sig.push(`${rel}/`)
      for (const child of children.toReversed()) {
        if (!isCacheName(child)) {
          stack.push(`${rel}/${child}`)
        }
      }
    } else if (info.isFile() || info.isSymbolicLink()) {
      out.paths.push(rel)
      out.bytes += info.size
      sig.push(`${rel}\t${info.size}\t${info.mtimeMs}`)
    }
    // Sockets and pipes live only while their process runs; there is nothing in them to copy.
  }
  out.sig = sig.join('\n')
  return out
}

/** `git status` of the worktree: changed paths and ignored ones beyond caches; null when git cannot tell. */
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
 * same path and tip the same day gets its own name, so no copy ever replaces another (Codex P1 24.11).
 */
export function archiveManifest({ repo, wtPath, head, paths, now, attic }) {
  if (paths.length === 0) {
    return { ok: true, copy: null }
  }
  const dir = join(attic, dayStamp(now))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  let copy = join(dir, copyFileName(repo, wtPath, head))
  if (existsSync(copy)) {
    copy = copy.replace(/\.tar\.gz$/, `-${now}-${process.pid}.tar.gz`)
  }
  const part = `${copy}.${process.pid}.part`
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
  renameSync(part, copy)
  return { ok: true, copy }
}
