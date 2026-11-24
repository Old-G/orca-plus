#!/usr/bin/env node
// Custom build (worktree-sweep): removes worktrees whose work is finished, so the disk does not fill up
// with one checkout per evening review, automation run, subagent and finished feature.
//
//   node scripts/orca-plus-worktree-sweep.mjs            dry run: what would go and why the rest stays
//   node scripts/orca-plus-worktree-sweep.mjs --apply    remove them
//   options: --idle-hours <n> (default 24) · --json · --report-dir <dir> (writes <dir>/<YYYY-MM-DD>.md)
//            --repo <main checkout> (repeatable; default: every local repo Orca has)
//            --root <dir> (only worktrees under it; default: every linked worktree of those repos — next to
//              the repo, in <repo>/.claude/worktrees, in ~/orca/workspaces, anywhere git has one)
//            --worktree <path> (repeatable: only these) · --closed-chat (with --worktree: the chat working in it
//              was just closed, so no --idle-hours wait; everything else still holds)
//            --max-copy-mb <n> (default 1024, see below) · --attic <dir> · --log <file> (where copies and the log go)
//
// A worktree goes only when all of this holds:
//   - it is not the main checkout, is not locked or pinned;
//   - no agent in it is still working, no terminal is live in it, and no process has its folder as cwd;
//   - nothing happened in it for --idle-hours (Orca's activity stamp and git's own index/HEAD files);
//   - `git status` is empty — no edits, no untracked files;
//   - every change on its branch is already in the project's base branch (see landedIn()).
// Before a branch is deleted its tip is kept as refs/orca-plus-sweep/<YYYYMMDD>/<branch>-<sha12> for 30 days,
// `/` in the branch written as %2F (a name over 200 bytes is cut and ends in %h<hash>; the log has the
// branch), so `git worktree add <dir> refs/orca-plus-sweep/<date>/feat%2Fx-<sha12>` brings `feat/x` back
// (`git for-each-ref refs/orca-plus-sweep` lists them). Ignored files that are not caches (run state, audit
// logs, outputs, .env) are copied first to <attic>/<YYYYMMDD>/<repo>--<folder>-<sha12>.tar.gz, kept 30 days
// too (`tar -xzf <copy> -C <dir>` puts them back); a worktree whose such files pass --max-copy-mb stays.
// Caches (node_modules, __pycache__, .venv, dist…) are not copied. Remote branches are never touched.
// Folders under ~/orca/workspaces that git does not know as worktrees are listed, never deleted.
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import {
  BACKUP_REF_PREFIX,
  CACHE_NAMES,
  CACHE_SUFFIXES,
  DAY_MS,
  HOUR_MS,
  OUTSIDE_ROOT,
  backupRefName,
  copyFileName,
  dayStamp,
  formatBytes,
  isBackupExpired,
  isCacheName,
  keepReasons,
  parseLsofCwd,
  parseStatusZ,
  parseWorktreePorcelain,
  processInside
} from './orca-plus-worktree-sweep-rules.mjs'
import {
  closesSince,
  isoWeek,
  mergeWeekReport,
  renderNight
} from './orca-plus-worktree-sweep-report.mjs'
import {
  git,
  gitRaw,
  gitTouchedAt,
  landedIn,
  real,
  repoBusy,
  run,
  verified
} from './orca-plus-worktree-sweep-git.mjs'

// ---- side effects below ----

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

/** `git fetch` of the repo's remote, once per run, so a merge request merged an hour ago reads as merged. */
function fetchOnce(mainPath, fetched) {
  if (fetched.has(mainPath)) {
    return
  }
  fetched.add(mainPath)
  // Why: no prompt can hang a background run — a password remote just fails, and 60 s caps the rest.
  run('git', ['-C', mainPath, 'fetch', '--quiet', '--no-tags', 'origin'], {
    timeout: 60_000,
    env: { GIT_TERMINAL_PROMPT: '0' }
  })
}

/** Size of the ignored files a removal would copy (caches skipped), stopping once past `max`. */
function ignoredSize(wtPath, entries, max) {
  let bytes = 0
  const stack = entries.map((entry) => join(wtPath, entry))
  while (stack.length > 0 && bytes <= max) {
    const path = stack.pop()
    let info
    try {
      info = lstatSync(path)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      for (const child of readdirSync(path)) {
        if (!isCacheName(child)) {
          stack.push(join(path, child))
        }
      }
    } else {
      bytes += info.size
    }
  }
  return bytes
}

function gatherRepo(mainPath, orca, opts, now, procs, fetched) {
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
    if (opts.worktrees.length > 0 && !opts.worktrees.includes(path)) {
      continue
    }
    const known = orca.byPath.get(path)
    const underRoot = !opts.root || path.startsWith(opts.root + sep)
    const ev = {
      isMain: false,
      bare: wt.bare,
      underRoot,
      locked: wt.locked,
      pinned: known?.pinned ?? false,
      liveAgent: known?.liveAgent ?? false,
      // An Orca worktree with no ps row: its agents are unread, so it is not touched.
      orcaUnread: known ? !known.psRead : false,
      liveTerminal: known?.liveTerminal ?? false,
      // Why: after a chat close the owner still has its workspace selected; Orca+ checked no tab is left.
      onScreen: !opts.closedChat && (known?.isActive ?? false),
      // Why: a shell in Terminal.app, a Claude subagent or a run outside Orca is invisible to `orca worktree ps`.
      liveProcess: procs ? processInside(procs, path) : null,
      processesUnread: procs === null,
      minIdleMs: opts.closedChat ? 0 : opts.idleHours * HOUR_MS,
      idleMs: null,
      dirtyCount: null,
      landedIn: null,
      copyTooBig: null
    }
    let ignored = []
    // Why: the costly git checks are skipped once a cheap reason already keeps it.
    if (
      underRoot &&
      !ev.locked &&
      !ev.pinned &&
      !ev.orcaUnread &&
      !ev.liveAgent &&
      !ev.liveTerminal &&
      !ev.onScreen &&
      !ev.liveProcess &&
      !ev.processesUnread
    ) {
      const touched = Math.max(known?.lastActivityAt ?? 0, gitTouchedAt(path))
      ev.idleMs = touched ? now - touched : null
      if (ev.idleMs === null || ev.idleMs >= ev.minIdleMs) {
        const status = gitRaw(
          path,
          'status',
          '--porcelain',
          '-z',
          '--ignored=traditional',
          '--untracked-files=normal'
        )
        const parsed = status.ok ? parseStatusZ(status.out) : null
        ev.dirtyCount = parsed ? parsed.dirty.length : null
        if (ev.dirtyCount === 0) {
          ev.landedIn = landedIn(path, mainPath, wt.branch)
          if (!ev.landedIn && opts.fetch) {
            fetchOnce(mainPath, fetched)
            ev.landedIn = landedIn(path, mainPath, wt.branch)
          }
        }
        if (ev.landedIn && parsed.ignored.length > 0) {
          const bytes = ignoredSize(path, parsed.ignored, opts.maxCopyBytes)
          ev.copyTooBig =
            bytes > opts.maxCopyBytes ? `over ${formatBytes(opts.maxCopyBytes)}` : null
          ignored = parsed.ignored
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
      ignored,
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

/** Copies the worktree's ignored files (caches left out) to the attic; null when there are none. */
function copyIgnored(row, now, attic) {
  if (row.ignored.length === 0) {
    return { ok: true, copy: null }
  }
  const dir = join(attic, dayStamp(now))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const copy = join(dir, copyFileName(row.repo, row.path, row.head))
  const part = `${copy}.part`
  const excludes = [...CACHE_NAMES, ...CACHE_SUFFIXES.map((suffix) => `*${suffix}`)].flatMap(
    (name) => ['--exclude', name]
  )
  const packed = run('tar', ['-czf', part, '-C', row.path, ...excludes, '--null', '-T', '-'], {
    input: `${row.ignored.join('\0')}\0`,
    timeout: 600_000
  })
  if (!packed.ok || !existsSync(part)) {
    rmSync(part, { force: true })
    return { ok: false, err: packed.err || 'no archive written' }
  }
  // Why: run state and .env copies can hold secrets; the copy is the owner's alone.
  chmodSync(part, 0o600)
  renameSync(part, copy)
  return { ok: true, copy }
}

function removeOne(row, now, log, opts) {
  const backup = backupRefName(
    dayStamp(now),
    row.branch ?? `detached-${basename(row.path)}`,
    row.head
  )
  const saved = git(row.mainPath, 'update-ref', backup, row.head)
  if (!saved.ok) {
    return { ok: false, step: 'backup ref', err: saved.err }
  }
  const copied = copyIgnored(row, now, opts.attic)
  if (!copied.ok) {
    return { ok: false, step: 'copy of ignored files', err: copied.err }
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
    copy: copied.copy,
    branchDeleted,
    trigger: opts.closedChat ? 'chat-close' : 'sweep'
  })
  return { ok: true, backup, copy: copied.copy, branchDeleted }
}

/** Copies older than the backup refs' 30 days go with them. */
function pruneAttic(attic, now, log) {
  if (!existsSync(attic)) {
    return
  }
  for (const day of readdirSync(attic)) {
    if (/^\d{8}$/.test(day) && isBackupExpired(`${BACKUP_REF_PREFIX}${day}/x`, now)) {
      rmSync(join(attic, day), { recursive: true, force: true })
      log({ event: 'copies-expired', dir: join(attic, day) })
    }
  }
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
    root: null,
    idleHours: 24,
    repos: [],
    worktrees: [],
    closedChat: false,
    fetch: false,
    reportDir: null,
    maxCopyBytes: 1024 * 1024 ** 2,
    attic: join(homedir(), 'Library', 'Application Support', 'orca-plus', 'worktree-sweep-copies')
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') {
      opts.apply = true
    } else if (arg === '--json') {
      opts.json = true
    } else if (arg === '--root') {
      opts.root = real(argv[++i])
    } else if (arg === '--idle-hours') {
      opts.idleHours = Number(argv[++i])
    } else if (arg === '--repo') {
      opts.repos.push(real(argv[++i]))
    } else if (arg === '--worktree') {
      opts.worktrees.push(real(argv[++i]))
    } else if (arg === '--closed-chat') {
      opts.closedChat = true
    } else if (arg === '--fetch') {
      opts.fetch = true
    } else if (arg === '--report-dir') {
      opts.reportDir = argv[++i]
    } else if (arg === '--max-copy-mb') {
      opts.maxCopyBytes = Number(argv[++i]) * 1024 ** 2
    } else if (arg === '--attic') {
      opts.attic = argv[++i]
    } else if (arg === '--log') {
      opts.logFile = argv[++i]
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  if (!Number.isFinite(opts.idleHours) || opts.idleHours < 1) {
    throw new Error('--idle-hours must be ≥ 1')
  }
  if (!Number.isFinite(opts.maxCopyBytes) || opts.maxCopyBytes <= 0) {
    throw new Error('--max-copy-mb must be > 0')
  }
  if (opts.closedChat && opts.worktrees.length === 0) {
    throw new Error(
      '--closed-chat needs --worktree: it skips the wait for one worktree, not for all'
    )
  }
  return opts
}

/** The main checkout of the repo a worktree belongs to (the first entry of `git worktree list`). */
function mainCheckoutOf(wtPath) {
  const listed = git(wtPath, 'worktree', 'list', '--porcelain')
  const first = listed.ok ? parseWorktreePorcelain(listed.out)[0] : null
  return first && !first.bare ? real(first.path) : null
}

/** Every running process with its working folder; null when lsof cannot tell (then nothing goes). */
function readProcesses() {
  const res = run('lsof', ['-n', '-P', '-w', '+c', '0', '-d', 'cwd', '-F', 'pcn'], {
    timeout: 60_000
  })
  // lsof exits 1 when it could not read some process; what it did read is still good.
  return /^p\d+/m.test(res.out) ? parseLsofCwd(res.out) : null
}

/** «.claude/worktrees/x» for a worktree inside its repo, the folder name for one elsewhere. */
function displayName(row) {
  const inside = relative(row.mainPath, row.path)
  return inside && !inside.startsWith('..') ? inside : basename(row.path)
}

function writeReport(opts, now, rows, results, logFile) {
  const removed = results.filter((r) => r.result.ok)
  const failed = results.filter((r) => !r.result.ok)
  const kept = [
    ...rows.filter((r) => !r.remove && r.reasons[0] !== OUTSIDE_ROOT),
    ...failed.map((r) => ({ ...r, reasons: [`removal failed at ${r.result.step}`] }))
  ]
  const night = renderNight({
    now,
    removed: removed.map((r) => ({ repo: r.repo, name: displayName(r) })),
    kept: kept.map((r) => ({ repo: r.repo, name: displayName(r), reason: r.reasons[0] })),
    onClose: closesSince(logFile, now - DAY_MS),
    copies: removed.filter((r) => r.result.copy).length,
    attic: opts.attic.replace(homedir(), '~')
  })
  mkdirSync(opts.reportDir, { recursive: true })
  const file = join(opts.reportDir, `${isoWeek(now)}.md`)
  let existing = null
  try {
    existing = readFileSync(file, 'utf8')
  } catch {
    existing = null
  }
  writeFileSync(`${file}.part`, mergeWeekReport(existing, now, night))
  renameSync(`${file}.part`, file)
  return file
}

function main() {
  // Why: Orca+ runs this with its Electron as Node; git, tar and the orca CLI must not inherit that.
  delete process.env.ELECTRON_RUN_AS_NODE
  const opts = parseArgs(process.argv.slice(2))
  const now = Date.now()
  const logFile = opts.logFile ?? join(homedir(), 'Library', 'Logs', 'orca-plus-worktree-sweep.log')
  const log = (row) => {
    if (!opts.apply) {
      return
    }
    mkdirSync(dirname(logFile), { recursive: true })
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
  // --repo narrows the sweep to the named main checkouts (a test repo, one project); --worktree to the
  // repos those worktrees belong to.
  const repos =
    opts.worktrees.length > 0
      ? [...new Set(opts.worktrees.map(mainCheckoutOf).filter(Boolean))]
      : opts.repos.length > 0
        ? opts.repos
        : orca.repos
  const procs = readProcesses()
  const fetched = new Set()
  const rows = repos.flatMap((repo) => gatherRepo(repo, orca, opts, now, procs, fetched))
  const workspaces = opts.root ?? real(join(homedir(), 'orca', 'workspaces'))
  const known = new Set([...orca.byPath.keys(), ...rows.map((r) => r.path)])
  const strays = opts.worktrees.length > 0 ? [] : strayFolders(workspaces, known)
  const results = []
  let report = null
  if (opts.apply) {
    for (const row of rows.filter((r) => r.remove)) {
      const result = removeOne(row, now, log, opts)
      if (!result.ok) {
        log({ event: 'failed', repo: row.repo, path: row.path, step: result.step, err: result.err })
      }
      results.push({ ...row, result })
    }
    if (opts.closedChat) {
      for (const row of rows.filter((r) => !r.remove)) {
        log({
          event: 'kept',
          trigger: 'chat-close',
          repo: row.repo,
          path: row.path,
          reasons: row.reasons
        })
      }
    }
    for (const repo of repos) {
      git(repo, 'worktree', 'prune')
    }
    pruneBackups(repos, now, log)
    pruneAttic(opts.attic, now, log)
    if (opts.reportDir) {
      report = writeReport(opts, now, rows, results, logFile)
    }
    if (!opts.closedChat) {
      log({ event: 'run', trigger: 'sweep', removed: results.filter((r) => r.result.ok).length })
    }
  }
  if (opts.json) {
    console.log(
      JSON.stringify({ apply: opts.apply, root: opts.root, rows, strays, results, report }, null, 1)
    )
    return
  }
  const goes = rows.filter((r) => r.remove)
  const stays = rows.filter((r) => !r.remove && r.reasons[0] !== OUTSIDE_ROOT)
  console.log(
    `${opts.apply ? 'Removed' : 'Would remove'} ${goes.length} of ${rows.length} worktrees${opts.root ? ` under ${opts.root}` : ''}`
  )
  for (const r of goes) {
    const res = results.find((x) => x.path === r.path)?.result
    const tail = res && !res.ok ? `  FAILED at ${res.step}: ${res.err}` : ''
    console.log(
      `  - ${r.repo} · ${displayName(r)} [${r.branch ?? 'detached'}] → ${r.landedIn}${tail}`
    )
  }
  console.log(`Stays: ${stays.length}`)
  for (const r of stays) {
    console.log(`  · ${r.repo} · ${displayName(r)} — ${r.reasons.join('; ')}`)
  }
  if (strays.length) {
    console.log(`Folders git does not know as worktrees (left alone): ${strays.length}`)
    for (const s of strays) {
      console.log(`  ? ${s}`)
    }
  }
  if (report) {
    console.log(`Report: ${report}`)
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
