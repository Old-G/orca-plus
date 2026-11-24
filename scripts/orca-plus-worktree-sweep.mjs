#!/usr/bin/env node
// Custom build (worktree-sweep): removes worktrees whose work is finished, so the disk does not fill up
// with one checkout per evening review, automation run, subagent and finished feature.
//
//   node scripts/orca-plus-worktree-sweep.mjs            dry run: what would go and why the rest stays
//   node scripts/orca-plus-worktree-sweep.mjs --apply    remove them
//   options: --idle-hours <n> (default 24) · --json · --report-dir <dir> (writes <dir>/<ISO week>.md)
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
//   - no tab is open in it in Orca (nightly; after a chat close Orca+ checks the tabs itself);
//   - it holds no other checkout (a nested worktree or clone would go with it);
//   - `git status` is empty — no edits, no untracked files — and no tracked file is hidden from it
//     (assume-unchanged, skip-worktree);
//   - every change on its branch is already in the project's base branch (see landedIn()).
// Right before the removal all of it is read again — HEAD, branch, status, ignored files, processes and
// Orca's view — and a worktree that moved meanwhile stays; its branch goes only at the tip that was backed up.
// Before a branch is deleted its tip is kept as refs/orca-plus-sweep/<YYYYMMDD>/<branch>-<sha12> for 30 days,
// `/` in the branch written as %2F (a name over 200 bytes is cut and ends in %h<hash>; the log has the
// branch), so `git worktree add <dir> refs/orca-plus-sweep/<date>/feat%2Fx-<sha12>` brings `feat/x` back
// (`git for-each-ref refs/orca-plus-sweep` lists them). Ignored files that are not caches (run state, audit
// logs, outputs, .env) are copied first to <attic>/<YYYYMMDD>/<repo>--<folder>-<sha12>-<hash>.tar.gz, kept 30
// days too (`tar -xzf <copy> -C <dir>` puts them back), and the copy is checked to list every file before
// anything goes; a worktree whose such files pass --max-copy-mb stays. Caches (node_modules, __pycache__,
// .venv, dist…) below an ignored folder are not copied. Remote branches are never touched.
// Folders under ~/orca/workspaces that git does not know as worktrees are listed, never deleted.
// Repos are Orca's local git projects, each checked to be its own repo's main checkout. ORCA_PLUS_SWEEP_ORCA
// names the orca CLI to ask (Orca+ passes its bundled one).
import {
  appendFileSync,
  existsSync,
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
  HOUR_MS,
  OUTSIDE_ROOT,
  backupRefName,
  checkoutInside,
  dayStamp,
  formatBytes,
  isBackupExpired,
  keepReasons,
  parseWorktreePorcelain,
  processInside
} from './orca-plus-worktree-sweep-rules.mjs'
import {
  MAX_COPY_FILES,
  archiveManifest,
  hiddenTracked,
  inspectIgnored,
  lockCheckout,
  readStatus
} from './orca-plus-worktree-sweep-files.mjs'
import {
  closesSince,
  isoWeek,
  mergeWeekReport,
  renderNight
} from './orca-plus-worktree-sweep-report.mjs'
import {
  ORCA_CLI,
  orcaEvidence,
  readOrca,
  readProcesses
} from './orca-plus-worktree-sweep-orca.mjs'
import {
  deleteBranch,
  fetchOrigin,
  git,
  gitTouchedAt,
  isMainCheckout,
  landedIn,
  real,
  repoBusy,
  run,
  verified
} from './orca-plus-worktree-sweep-git.mjs'

// ---- side effects below ----

/** `git fetch` of the repo's remote, once per run, so a merge request merged an hour ago reads as merged. */
function fetchOnce(mainPath, fetched) {
  if (!fetched.has(mainPath)) {
    fetched.add(mainPath)
    fetchOrigin(mainPath)
  }
}

/** Every checkout Orca or git knows on this machine: a worktree holding one of them stays. */
function allCheckouts(orca) {
  const paths = new Set(orca.byPath.keys())
  for (const repo of orca.repos) {
    const listed = git(repo, 'worktree', 'list', '--porcelain')
    for (const wt of listed.ok ? parseWorktreePorcelain(listed.out) : []) {
      paths.add(real(wt.path))
    }
  }
  return [...paths]
}

/** The git half of the evidence: status, hidden tracked files, the proof it landed, its ignored files. */
function gitEvidence(ev, path, mainPath, branch, ctx) {
  const status = readStatus(path)
  ev.dirtyCount = status ? status.dirty.length : null
  if (ev.dirtyCount !== 0) {
    return
  }
  const hidden = hiddenTracked(path)
  ev.hiddenCount = hidden ? hidden.length : null
  if (ev.hiddenCount !== 0) {
    return
  }
  ev.landedIn = landedIn(path, mainPath, branch)
  // Why only with --apply: a dry run changes no ref, remote-tracking ones included (Codex P2 24.11).
  if (!ev.landedIn && ctx.opts.fetch && ctx.opts.apply) {
    fetchOnce(mainPath, ctx.fetched)
    ev.landedIn = landedIn(path, mainPath, branch)
  }
  if (ev.landedIn) {
    const max = ctx.opts.maxCopyBytes
    const manifest = inspectIgnored(path, status, max, { deep: true })
    ev.nestedCheckout = manifest.nested
    ev.ignoredUnreadable = manifest.unreadable
    ev.copyTooBig = !manifest.over
      ? null
      : manifest.bytes > max
        ? `over ${formatBytes(max)}`
        : `over ${MAX_COPY_FILES} files`
  }
}

function gatherRepo(mainPath, ctx) {
  const { orca, opts, now, procs } = ctx
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
      ...orcaEvidence(known, opts),
      // Why: a shell in Terminal.app, a Claude subagent or a run outside Orca is invisible to `orca worktree ps`.
      liveProcess: procs ? processInside(procs, path) : null,
      processesUnread: procs === null,
      // Why: git removes the folder whole, a nested worktree or a clone in an ignored folder with it.
      holdsCheckout: checkoutInside(ctx.checkouts, path),
      minIdleMs: opts.closedChat ? 0 : opts.idleHours * HOUR_MS,
      idleMs: null,
      dirtyCount: null,
      hiddenCount: null,
      landedIn: null,
      nestedCheckout: null,
      ignoredUnreadable: null,
      copyTooBig: null
    }
    // Why: the costly git checks run only once no cheap reason keeps it.
    if (keepReasons({ ...ev, dirtyCount: 0, hiddenCount: 0, landedIn: 'x' }).length === 0) {
      const touched = Math.max(known?.lastActivityAt ?? 0, gitTouchedAt(path))
      ev.idleMs = touched ? now - touched : null
      if (ev.idleMs === null || ev.idleMs >= ev.minIdleMs) {
        gitEvidence(ev, path, mainPath, wt.branch, ctx)
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
      orcaActivityAt: known?.lastActivityAt ?? 0,
      orcaOpenTab: known?.openTab ?? false,
      landedIn: ev.landedIn,
      reasons,
      remove: reasons.length === 0
    })
  }
  return rows
}

/** The folder's entries that are folders; none when it cannot be read (a dangling link, no access). */
function subfolders(dir) {
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return !name.startsWith('.') && statSync(join(dir, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/**
 * Folders under the root that git does not know as worktrees: listed for the owner, never deleted. An
 * entry it cannot read is passed over, so it never stops the night's removals (Codex P2 24.11).
 */
function strayFolders(root, knownPaths) {
  const out = []
  for (const project of subfolders(root)) {
    const projectDir = join(root, project)
    if (knownPaths.has(real(projectDir))) {
      continue
    }
    for (const child of subfolders(projectDir)) {
      const dir = join(projectDir, child)
      if (!knownPaths.has(real(dir)) && existsSync(join(dir, '.git'))) {
        out.push(dir)
      }
    }
  }
  return out
}

/**
 * Reads the worktree again right before it goes (Codex P1 24.11). With `live`, first no process in it and
 * Orca's view unchanged; then, last so the removal follows at once, the same HEAD and branch, nothing
 * uncommitted or hidden, the ignored files still copyable — and with `sig`, the very ones just copied.
 * Returns `{ manifest }`, or `{ why }` when it must stay.
 */
function recheck(row, ctx, { live, sig }) {
  if (live) {
    const procs = readProcesses()
    const proc = procs ? processInside(procs, row.path) : 'running processes unread (lsof)'
    if (proc) {
      return { why: `a process works in it: ${proc}` }
    }
    const orca = readOrca(false)
    if (!orca) {
      return { why: 'Orca is not answering' }
    }
    const known = orca.byPath.get(row.path)
    if ((known?.lastActivityAt ?? 0) > row.orcaActivityAt) {
      return { why: 'active in Orca since the check' }
    }
    // Why: a chat close does not count the tabs (Orca+ did), but one opened since then keeps it (Codex P2 24.11).
    if (known?.openTab && !row.orcaOpenTab) {
      return { why: 'a tab opened in it in Orca since the check' }
    }
    const reasons = keepReasons({
      ...orcaEvidence(known, ctx.opts),
      underRoot: true,
      minIdleMs: 0,
      idleMs: null,
      dirtyCount: 0,
      hiddenCount: 0,
      landedIn: row.landedIn
    })
    if (reasons.length > 0) {
      return { why: reasons[0] }
    }
  }
  const head = git(row.path, 'rev-parse', 'HEAD')
  if (!head.ok || head.out !== row.head) {
    return { why: 'HEAD moved since the check' }
  }
  const ref = git(row.path, 'symbolic-ref', '-q', 'HEAD')
  if ((ref.ok ? ref.out.replace(/^refs\/heads\//, '') : null) !== row.branch) {
    return { why: 'its branch changed since the check' }
  }
  const status = readStatus(row.path)
  if (!status || status.dirty.length > 0) {
    return { why: 'uncommitted files appeared' }
  }
  const hidden = hiddenTracked(row.path)
  if (!hidden || hidden.length > 0) {
    return { why: 'tracked files hidden from git status' }
  }
  const manifest = inspectIgnored(row.path, status, ctx.opts.maxCopyBytes, { deep: live })
  if (manifest.over || manifest.nested || manifest.unreadable) {
    return { why: 'its ignored files changed: too big, unreadable or a checkout inside' }
  }
  if (sig !== undefined && manifest.sig !== sig) {
    return { why: 'its ignored files changed while they were copied' }
  }
  return { manifest }
}

function removeOne(row, ctx) {
  const release = lockCheckout(ctx.opts.attic, row.path)
  if (!release) {
    return { ok: false, step: 'lock', err: 'another sweep is removing it' }
  }
  try {
    return removeLocked(row, ctx)
  } finally {
    release()
  }
}

function removeLocked(row, ctx) {
  const { now, log, opts } = ctx
  const before = recheck(row, ctx, { live: false })
  if (before.why) {
    return { ok: false, step: 'check before removal', err: before.why }
  }
  const backup = backupRefName(
    dayStamp(now),
    row.branch ?? `detached-${basename(row.path)}`,
    row.head
  )
  // Why: a backup ref another removal already wrote is that removal's; a failure here never drops it.
  const ownBackup = !verified(row.mainPath, backup)
  const saved = git(row.mainPath, 'update-ref', backup, row.head)
  if (!saved.ok) {
    return { ok: false, step: 'backup ref', err: saved.err }
  }
  const undo = (copy) => {
    if (ownBackup) {
      git(row.mainPath, 'update-ref', '-d', backup, row.head)
    }
    if (copy) {
      rmSync(copy, { force: true })
    }
  }
  const copied = archiveManifest({
    repo: row.repo,
    wtPath: row.path,
    head: row.head,
    paths: before.manifest.paths,
    now,
    attic: opts.attic
  })
  if (!copied.ok) {
    undo(null)
    return { ok: false, step: 'copy of ignored files', err: copied.err }
  }
  // Why again after the copy: an agent may have committed, a tab opened or a process written meanwhile.
  const after = recheck(row, ctx, { live: true, sig: before.manifest.sig })
  if (after.why) {
    undo(copied.copy)
    return { ok: false, step: 'check before removal', err: after.why }
  }
  // Why no --delete-branch: Orca would delete the branch wherever it points by then; deleteBranch() checks.
  const removed = row.orcaId
    ? run(ORCA_CLI, ['worktree', 'rm', '--worktree', `id:${row.orcaId}`, '--json'], {
        timeout: 180_000
      })
    : git(row.mainPath, 'worktree', 'remove', row.path)
  if (!removed.ok || existsSync(row.path)) {
    return { ok: false, step: 'remove', err: removed.err || removed.out || 'folder still there' }
  }
  // Why: landedIn() proved the work is in the base; Orca keeps a branch it cannot prove merged (a rebased base).
  const branchDeleted = deleteBranch(row)
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

/** «.claude/worktrees/x» for a worktree inside its repo, the folder name for one elsewhere. */
function displayName(row) {
  const inside = relative(row.mainPath, row.path)
  return inside && !inside.startsWith('..') ? inside : basename(row.path)
}

/** Writes the week's report; `readTo` is how far into the log it read the chat closes. */
function writeReport(opts, now, rows, results, logFile) {
  const removed = results.filter((r) => r.result.ok)
  const failed = results.filter((r) => !r.result.ok)
  const kept = [
    ...rows.filter((r) => !r.remove && r.reasons[0] !== OUTSIDE_ROOT),
    ...failed.map((r) => ({
      ...r,
      reasons: [`removal failed at ${r.result.step}${r.result.err ? `: ${r.result.err}` : ''}`]
    }))
  ]
  const onClose = closesSince(logFile)
  const night = renderNight({
    now,
    removed: removed.map((r) => ({ repo: r.repo, name: displayName(r) })),
    kept: kept.map((r) => ({ repo: r.repo, name: displayName(r), reason: r.reasons[0] })),
    onClose,
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
  return { file, readTo: onClose.readTo }
}

/**
 * The repos to sweep: Orca's local git projects; `--repo` narrows them (a test repo, one project) and
 * `--worktree` to the repos those worktrees belong to — among Orca's, unless `--repo` names them.
 */
function sweptRepos(opts, orca) {
  const named = opts.repos.filter((repo) => {
    const ok = isMainCheckout(repo)
    if (!ok) {
      console.error(`worktree-sweep: ${repo} is not the main checkout of its repo — skipped`)
    }
    return ok
  })
  const allowed = opts.repos.length > 0 ? named : orca.repos
  if (opts.worktrees.length === 0) {
    return allowed
  }
  return [...new Set(opts.worktrees.map(mainCheckoutOf))].filter((repo) => allowed.includes(repo))
}

function sweep(opts, now, log, logFile) {
  const orca = readOrca()
  if (!orca) {
    // Why: without Orca's view a live chat in a worktree is invisible; better to skip a night than to cut one.
    console.error(
      'worktree-sweep: Orca is not answering or its worktree list is cut short (orca worktree list/ps/repo list) — nothing removed'
    )
    process.exit(opts.apply ? 0 : 1)
  }
  const repos = sweptRepos(opts, orca)
  const ctx = {
    orca,
    opts,
    now,
    log,
    procs: readProcesses(),
    fetched: new Set(),
    checkouts: allCheckouts(orca)
  }
  const rows = repos.flatMap((repo) => gatherRepo(repo, ctx))
  const workspaces = opts.root ?? real(join(homedir(), 'orca', 'workspaces'))
  const known = new Set([...orca.byPath.keys(), ...ctx.checkouts, ...rows.map((r) => r.path)])
  const strays = opts.worktrees.length > 0 ? [] : strayFolders(workspaces, known)
  const results = []
  let report = null
  if (opts.apply) {
    for (const row of rows.filter((r) => r.remove)) {
      const result = removeOne(row, ctx)
      if (!result.ok) {
        log({
          event: 'failed',
          trigger: opts.closedChat ? 'chat-close' : 'sweep',
          repo: row.repo,
          path: row.path,
          step: result.step,
          err: result.err
        })
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
    // Why the marker only with a report: the next report starts where this one read the log, so a chat
    // close logged during or after this run is reported once, never skipped (Codex P3 24.11).
    if (opts.reportDir && !opts.closedChat) {
      const written = writeReport(opts, now, rows, results, logFile)
      report = written.file
      log({
        event: 'run',
        trigger: 'sweep',
        removed: results.filter((r) => r.result.ok).length,
        readTo: written.readTo
      })
    }
  }
  return { rows, strays, results, report }
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
    appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`)
  }
  const { rows, strays, results, report } = sweep(opts, now, log, logFile)
  if (opts.json) {
    console.log(
      JSON.stringify({ apply: opts.apply, root: opts.root, rows, strays, results, report }, null, 1)
    )
    return
  }
  const goes = rows.filter((r) => r.remove)
  const stays = rows.filter((r) => !r.remove && r.reasons[0] !== OUTSIDE_ROOT)
  const count = opts.apply ? results.filter((r) => r.result.ok).length : goes.length
  console.log(
    `${opts.apply ? 'Removed' : 'Would remove'} ${count} of ${rows.length} worktrees${opts.root ? ` under ${opts.root}` : ''}`
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
