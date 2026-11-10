#!/usr/bin/env node
// Custom build (worktree-sweep): removes worktrees whose work is finished, so the workspace folder
// does not fill up with one checkout per evening review, automation run and finished feature.
//
//   node scripts/orca-plus-worktree-sweep.mjs            dry run: what would go and why the rest stays
//   node scripts/orca-plus-worktree-sweep.mjs --apply    remove them
//   options: --root <dir> (default ~/orca/workspaces) · --idle-hours <n> (default 24) · --json
//            --repo <main checkout> (repeatable; default: every local repo Orca has)
//
// A worktree goes only when all of this holds:
//   - it lives under the workspace root, is not the main checkout, is not locked or pinned;
//   - no agent in it is still working and no terminal is live in it;
//   - nothing happened in it for --idle-hours (Orca's activity stamp and git's own index/HEAD files);
//   - `git status` is empty — no edits, no untracked files (ignored ones such as node_modules are fine);
//   - every change on its branch is already in the project's base branch (see landedIn()).
// Before a branch is deleted its tip is kept as refs/orca-plus-sweep/<YYYYMMDD>/<branch>-<sha12> for 30 days,
// `/` in the branch written as %2F, so `git worktree add <dir> refs/orca-plus-sweep/<date>/feat%2Fx-<sha12>`
// brings `feat/x` back (`git for-each-ref refs/orca-plus-sweep` lists them). Remote branches are never
// touched. Folders under the root that git does not know as worktrees are listed, never deleted.
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'

export const BACKUP_REF_PREFIX = 'refs/orca-plus-sweep/'
export const BACKUP_KEEP_DAYS = 30
const HOUR_MS = 3_600_000
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
    reasons.push('outside the workspace folder')
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
  }
  return reasons
}

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
  return `${BACKUP_REF_PREFIX}${day}/${flat}-${String(head).slice(0, 12)}`
}

export function dayStamp(now) {
  const d = new Date(now)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// ---- side effects below ----

function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeout ?? 120_000,
      maxBuffer: 256 * 1024 * 1024,
      cwd: opts.cwd
    })
    return { ok: true, out: out.trim() }
  } catch (error) {
    return {
      ok: false,
      out: String(error.stdout ?? '').trim(),
      err: String(error.stderr ?? error.message).trim()
    }
  }
}

const git = (cwd, ...args) => run('git', ['-C', cwd, ...args])
const verified = (cwd, ref) => git(cwd, 'rev-parse', '--verify', '-q', `${ref}^{commit}`).ok

/** Branches the work should have landed in: the main checkout's branch, the remote default, main/master. */
export function baseBranches(mainPath, wtPath) {
  const names = []
  const head = git(mainPath, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (head.ok && head.out !== 'HEAD') {
    names.push(head.out)
  }
  const remoteHead = git(wtPath, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD')
  if (remoteHead.ok && remoteHead.out) {
    names.push(remoteHead.out, remoteHead.out.replace(/^origin\//, ''))
  }
  names.push('main', 'master', 'origin/main', 'origin/master')
  return [...new Set(names)].filter((name) => verified(wtPath, name))
}

/** The commit a worktree was created at: the new side of the first line of its HEAD reflog. */
export function firstReflogCommit(text) {
  const m = /^[0-9a-f]{40,64} ([0-9a-f]{40,64}) /.exec(text)
  return m ? m[1] : null
}

function worktreeStart(wtPath) {
  const gitDir = git(wtPath, 'rev-parse', '--absolute-git-dir')
  if (!gitDir.ok) {
    return null
  }
  try {
    return firstReflogCommit(readFileSync(join(gitDir.out, 'logs', 'HEAD'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Which base already holds everything on HEAD, with the proof, or null. Proofs, cheapest first:
 * HEAD is an ancestor; merging HEAD would change nothing; HEAD was once in the base (its reflog — the
 * base was later rebased); every commit made in the worktree is in the base as the same patch, or — the
 * base rebased and fixups squashed after its reflog expired — by a descriptive subject, the commit the
 * worktree started at included.
 */
export function landedIn(wtPath, mainPath, branch) {
  const bases = baseBranches(mainPath, wtPath).filter((b) => b !== branch)
  for (const base of bases) {
    if (git(wtPath, 'merge-base', '--is-ancestor', 'HEAD', base).ok) {
      return `${base} (merged)`
    }
  }
  for (const base of bases) {
    const merged = git(wtPath, 'merge-tree', '--write-tree', '--no-messages', base, 'HEAD')
    const baseTree = git(wtPath, 'rev-parse', `${base}^{tree}`)
    if (merged.ok && baseTree.ok && merged.out.split('\n')[0] === baseTree.out) {
      return `${base} (same content)`
    }
  }
  const head = git(wtPath, 'rev-parse', 'HEAD').out
  for (const base of bases) {
    const fork = git(wtPath, 'merge-base', '--fork-point', base, 'HEAD')
    if (fork.ok && fork.out === head) {
      return `${base} (was in it before a rebase)`
    }
  }
  const start = worktreeStart(wtPath)
  if (!start || !git(wtPath, 'merge-base', '--is-ancestor', start, 'HEAD').ok) {
    return null
  }
  const own = git(wtPath, 'log', '--format=%s', `${start}..HEAD`)
  const startSubject = git(wtPath, 'log', '-1', '--format=%s', start)
  if (!own.ok || !startSubject.ok) {
    return null
  }
  const ownSubjects = own.out ? own.out.split('\n') : []
  for (const base of bases) {
    const baseLog = git(wtPath, 'log', '--format=%s', base, '-n', '20000')
    if (!baseLog.ok) {
      continue
    }
    const baseSubjects = baseLog.out.split('\n')
    const startInBase =
      git(wtPath, 'merge-base', '--is-ancestor', start, base).ok ||
      subjectsLanded([startSubject.out], baseSubjects)
    if (!startInBase) {
      continue
    }
    if (ownSubjects.length === 0) {
      return `${base} (no commits of its own)`
    }
    // `git cherry base HEAD start`: «-» = the same patch is in the base (rebased or cherry-picked).
    const cherry = git(wtPath, 'cherry', base, 'HEAD', start)
    if (cherry.ok && cherry.out && cherry.out.split('\n').every((l) => l.startsWith('- '))) {
      return `${base} (every commit as the same patch)`
    }
    if (subjectsLanded(ownSubjects, baseSubjects)) {
      return `${base} (every commit by subject)`
    }
  }
  return null
}

function mtimeMs(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** Time of the newest entry in a reflog's text (`<old> <new> <who> <unix-seconds> <tz>\t<what>`), in ms. */
export function lastReflogAt(text) {
  const lines = text.trimEnd().split('\n')
  const m = /\s(\d{9,})\s[+-]\d{4}\t/.exec(lines.at(-1) ?? '')
  return m ? Number(m[1]) * 1000 : 0
}

/**
 * When HEAD last moved — a commit, checkout or reset. Read from the reflog's newest entry, not file
 * times: every `git status` (Orca polls it) rewrites `index`, and gc/reflog expiry rewrites logs/HEAD.
 */
function gitTouchedAt(wtPath) {
  const gitDir = git(wtPath, 'rev-parse', '--absolute-git-dir')
  if (!gitDir.ok) {
    return 0
  }
  let reflogAt = 0
  try {
    reflogAt = lastReflogAt(readFileSync(join(gitDir.out, 'logs', 'HEAD'), 'utf8'))
  } catch {
    reflogAt = 0
  }
  return Math.max(reflogAt, mtimeMs(join(gitDir.out, 'HEAD')))
}

function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function orcaJson(args) {
  const res = run('orca', [...args, '--json'], { timeout: 60_000 })
  if (!res.ok) {
    return null
  }
  try {
    const parsed = JSON.parse(res.out)
    return parsed.ok ? parsed.result : null
  } catch {
    return null
  }
}

/** Orca's view: repos and, by real path, each worktree's id, pin, activity and live agents. */
function readOrca() {
  const list = orcaJson(['worktree', 'list', '--limit', '100000'])
  const ps = orcaJson(['worktree', 'ps', '--limit', '100000'])
  // Why: a cut page hides some worktrees' live agents; a worktree with no row would look idle (Codex P1 10.11).
  if (!list || !ps || list.truncated || ps.truncated) {
    return null
  }
  const byPath = new Map()
  for (const w of list.worktrees) {
    if (w.hostId && w.hostId !== 'local') {
      continue
    }
    byPath.set(real(w.path), {
      id: w.id,
      repoId: w.repoId,
      isMain: w.isMainWorktree,
      pinned: !!w.isPinned,
      lastActivityAt: w.lastActivityAt ?? 0
    })
  }
  for (const row of ps.worktrees) {
    const entry = byPath.get(real(row.path))
    if (!entry) {
      continue
    }
    entry.liveAgent = (row.agents ?? []).some((a) => a.state && a.state !== 'done')
    entry.liveTerminal =
      (row.liveTerminalCount ?? 0) > 0 ||
      !!row.hasAttachedPty ||
      (row.unverifiableTerminalCount ?? 0) > 0
    entry.isActive = !!row.isActive
    entry.psRead = true
  }
  const repos = [...byPath.entries()]
    .filter(([path, w]) => w.isMain && existsSync(path))
    .map(([path]) => path)
  return { byPath, repos, ps }
}

/** A rebase, merge or cherry-pick under way in the repo (an upstream sync rewriting its base, say). */
function repoBusy(mainPath) {
  const common = git(mainPath, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (!common.ok) {
    return true
  }
  const marks = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']
  const dirs = [common.out]
  const wtDir = join(common.out, 'worktrees')
  if (existsSync(wtDir)) {
    dirs.push(...readdirSync(wtDir).map((d) => join(wtDir, d)))
  }
  return dirs.some((dir) => marks.some((mark) => existsSync(join(dir, mark))))
}

function gatherRepo(mainPath, orca, opts, now) {
  // Why: mid-rebase the base branch and its reflog are being rewritten; the proofs would read noise.
  if (repoBusy(mainPath)) {
    return [
      {
        repo: basename(mainPath),
        mainPath,
        path: mainPath,
        branch: null,
        head: null,
        orcaId: null,
        landedIn: null,
        reasons: ['repo is mid-rebase or merge — skipped tonight'],
        remove: false,
        skippedRepo: true
      }
    ]
  }
  const listed = git(mainPath, 'worktree', 'list', '--porcelain')
  if (!listed.ok) {
    return []
  }
  const rows = []
  for (const wt of parseWorktreePorcelain(listed.out)) {
    const path = real(wt.path)
    if (path === real(mainPath) || wt.prunable || !existsSync(path)) {
      continue
    }
    const known = orca.byPath.get(path)
    const underRoot = path.startsWith(opts.root + sep)
    const ev = {
      isMain: false,
      bare: wt.bare,
      underRoot,
      locked: wt.locked,
      pinned: known?.pinned ?? false,
      liveAgent: known?.liveAgent ?? false,
      // An Orca worktree with no ps row: its agents are unread, so it is not touched.
      orcaUnread: known ? !known.psRead : false,
      liveTerminal: (known?.liveTerminal ?? false) || (known?.isActive ?? false),
      minIdleMs: opts.idleHours * HOUR_MS,
      idleMs: null,
      dirtyCount: null,
      landedIn: null
    }
    // Why: the costly git checks are skipped once a cheap reason already keeps it.
    if (
      underRoot &&
      !ev.locked &&
      !ev.pinned &&
      !ev.orcaUnread &&
      !ev.liveAgent &&
      !ev.liveTerminal
    ) {
      const touched = Math.max(known?.lastActivityAt ?? 0, gitTouchedAt(path))
      ev.idleMs = touched ? now - touched : null
      if (ev.idleMs === null || ev.idleMs >= ev.minIdleMs) {
        const status = git(path, 'status', '--porcelain', '--untracked-files=normal')
        ev.dirtyCount = status.ok ? (status.out ? status.out.split('\n').length : 0) : null
        if (ev.dirtyCount === 0) {
          ev.landedIn = landedIn(path, mainPath, wt.branch)
        }
      }
    }
    const reasons = keepReasons(ev)
    rows.push({
      repo: basename(mainPath),
      mainPath,
      path,
      branch: wt.branch,
      head: wt.head,
      orcaId: known?.id ?? null,
      landedIn: ev.landedIn,
      reasons,
      remove: reasons.length === 0
    })
  }
  return rows
}

/** Folders under the root that git does not know as worktrees: listed for the owner, never deleted. */
function strayFolders(root, knownPaths) {
  const out = []
  if (!existsSync(root)) {
    return out
  }
  for (const project of readdirSync(root)) {
    const projectDir = join(root, project)
    if (project.startsWith('.') || !statSync(projectDir).isDirectory()) {
      continue
    }
    if (knownPaths.has(real(projectDir))) {
      continue
    }
    for (const child of readdirSync(projectDir)) {
      const dir = join(projectDir, child)
      if (child.startsWith('.') || !statSync(dir).isDirectory()) {
        continue
      }
      if (!knownPaths.has(real(dir)) && existsSync(join(dir, '.git'))) {
        out.push(dir)
      }
    }
  }
  return out
}

function removeOne(row, now, log) {
  const backup = backupRefName(
    dayStamp(now),
    row.branch ?? `detached-${basename(row.path)}`,
    row.head
  )
  const saved = git(row.mainPath, 'update-ref', backup, row.head)
  if (!saved.ok) {
    return { ok: false, step: 'backup ref', err: saved.err }
  }
  const removed = row.orcaId
    ? run(
        'orca',
        ['worktree', 'rm', '--worktree', `id:${row.orcaId}`, '--delete-branch', '--json'],
        { timeout: 180_000 }
      )
    : git(row.mainPath, 'worktree', 'remove', row.path)
  if (!removed.ok || existsSync(row.path)) {
    return { ok: false, step: 'remove', err: removed.err || removed.out || 'folder still there' }
  }
  // Why: landedIn() proved the work is in the base; Orca keeps a branch it cannot prove merged (a rebased base).
  const branchDeleted =
    !row.branch ||
    !verified(row.mainPath, `refs/heads/${row.branch}`) ||
    git(row.mainPath, 'branch', '-D', row.branch).ok
  log({
    event: 'removed',
    repo: row.repo,
    path: row.path,
    branch: row.branch,
    head: row.head,
    landedIn: row.landedIn,
    backup,
    branchDeleted
  })
  return { ok: true, backup, branchDeleted }
}

function pruneBackups(repos, now, log) {
  for (const repo of repos) {
    const refs = git(repo, 'for-each-ref', '--format=%(refname)', BACKUP_REF_PREFIX)
    if (!refs.ok || !refs.out) {
      continue
    }
    for (const ref of refs.out.split('\n')) {
      if (isBackupExpired(ref, now) && git(repo, 'update-ref', '-d', ref).ok) {
        log({ event: 'backup-expired', repo, ref })
      }
    }
  }
}

function parseArgs(argv) {
  const opts = {
    apply: false,
    json: false,
    root: join(homedir(), 'orca', 'workspaces'),
    idleHours: 24,
    repos: []
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') {
      opts.apply = true
    } else if (arg === '--json') {
      opts.json = true
    } else if (arg === '--root') {
      opts.root = argv[++i]
    } else if (arg === '--idle-hours') {
      opts.idleHours = Number(argv[++i])
    } else if (arg === '--repo') {
      opts.repos.push(real(argv[++i]))
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  if (!Number.isFinite(opts.idleHours) || opts.idleHours < 1) {
    throw new Error('--idle-hours must be ≥ 1')
  }
  opts.root = real(opts.root)
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const now = Date.now()
  const logDir = join(homedir(), 'Library', 'Logs')
  const logFile = join(logDir, 'orca-plus-worktree-sweep.log')
  const log = (row) => {
    if (!opts.apply) {
      return
    }
    mkdirSync(logDir, { recursive: true })
    appendFileSync(logFile, `${JSON.stringify({ at: new Date(now).toISOString(), ...row })}\n`)
  }
  const orca = readOrca()
  if (!orca) {
    // Why: without Orca's view a live chat in a worktree is invisible; better to skip a night than to cut one.
    console.error(
      'worktree-sweep: Orca is not answering or its worktree list is cut short (orca worktree list/ps) — nothing removed'
    )
    process.exit(opts.apply ? 0 : 1)
  }
  // --repo narrows the sweep to the named main checkouts (a test repo, one project).
  const repos = opts.repos.length > 0 ? opts.repos : orca.repos
  const rows = repos.flatMap((repo) => gatherRepo(repo, orca, opts, now))
  const known = new Set([...orca.byPath.keys(), ...rows.map((r) => r.path)])
  const strays = strayFolders(opts.root, known)
  const results = []
  if (opts.apply) {
    for (const row of rows.filter((r) => r.remove)) {
      const result = removeOne(row, now, log)
      if (!result.ok) {
        log({ event: 'failed', repo: row.repo, path: row.path, step: result.step, err: result.err })
      }
      results.push({ ...row, result })
    }
    for (const repo of repos) {
      git(repo, 'worktree', 'prune')
    }
    pruneBackups(repos, now, log)
  }
  if (opts.json) {
    console.log(
      JSON.stringify({ apply: opts.apply, root: opts.root, rows, strays, results }, null, 1)
    )
    return
  }
  const goes = rows.filter((r) => r.remove)
  const stays = rows.filter((r) => !r.remove && r.reasons[0] !== 'outside the workspace folder')
  console.log(
    `${opts.apply ? 'Removed' : 'Would remove'} ${goes.length} of ${rows.length} worktrees under ${opts.root}`
  )
  for (const r of goes) {
    const res = results.find((x) => x.path === r.path)?.result
    const tail = res && !res.ok ? `  FAILED at ${res.step}: ${res.err}` : ''
    console.log(
      `  - ${r.repo} · ${basename(r.path)} [${r.branch ?? 'detached'}] → ${r.landedIn}${tail}`
    )
  }
  console.log(`Stays: ${stays.length}`)
  for (const r of stays) {
    console.log(`  · ${r.repo} · ${basename(r.path)} — ${r.reasons.join('; ')}`)
  }
  if (strays.length) {
    console.log(`Folders git does not know as worktrees (left alone): ${strays.length}`)
    for (const s of strays) {
      console.log(`  ? ${s}`)
    }
  }
}

if (process.argv[1] && real(process.argv[1]) === real(import.meta.filename)) {
  try {
    main()
  } catch (error) {
    console.error(`worktree-sweep: ${error.message}`)
    process.exit(2)
  }
}
