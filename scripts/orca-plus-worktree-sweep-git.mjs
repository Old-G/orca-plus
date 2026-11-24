// Custom build (worktree-sweep): what git says about a worktree for scripts/orca-plus-worktree-sweep.mjs —
// when it last moved, whether its work is in the base branch, whether its repo is mid-rebase.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  firstReflogCommit,
  lastReflogAt,
  parseWorktreePorcelain,
  subjectsLanded
} from './orca-plus-worktree-sweep-rules.mjs'

export function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      input: opts.input,
      timeout: opts.timeout ?? 120_000,
      // Why SIGKILL on a deadline: a child that ignores SIGTERM keeps a sync call waiting past it.
      killSignal: opts.killSignal ?? 'SIGTERM',
      maxBuffer: 256 * 1024 * 1024,
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : undefined
    })
    // `raw`: porcelain lines start with a space that trim() would eat.
    return { ok: true, out: opts.raw ? out : out.trim() }
  } catch (error) {
    return {
      ok: false,
      out: String(error.stdout ?? '').trim(),
      err: String(error.stderr ?? error.message).trim()
    }
  }
}

export const git = (cwd, ...args) => run('git', ['-C', cwd, ...args])

/**
 * `git fetch origin` that can neither ask nor hang: no prompt, askpass or credential dialog (a remote that
 * wants a password just fails), ssh in batch mode, killed at 60 s. It writes no FETCH_HEAD, fetches no
 * tags and prunes nothing, so a local tag or branch never goes because of it (Codex P2 24.11).
 */
export function fetchOrigin(mainPath) {
  return run(
    'git',
    [
      '-C',
      mainPath,
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-prune',
      '--no-write-fetch-head',
      'origin'
    ],
    {
      timeout: 60_000,
      killSignal: 'SIGKILL',
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'false',
        SSH_ASKPASS: 'false',
        SSH_ASKPASS_REQUIRE: 'never',
        GCM_INTERACTIVE: 'never',
        // Why not an inherited one: it may ask for a passphrase; ~/.ssh/config still applies.
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=20'
      }
    }
  )
}

/**
 * The folder is the main checkout of its own repo: git run there finds this folder as the top, and its git
 * dir is the repo's common dir (a linked worktree's is `.git/worktrees/<name>`; `--separate-git-dir` keeps
 * it elsewhere, which is fine). A folder project inside another repo (`/src/acme/docs`) is not (Codex P1 24.11).
 */
export function isMainCheckout(path) {
  const top = git(path, 'rev-parse', '--show-toplevel')
  const dirs = git(path, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir')
  if (!top.ok || !dirs.ok) {
    return false
  }
  const [gitDir, commonDir] = dirs.out.split('\n')
  return real(top.out) === path && !!gitDir && real(gitDir) === real(commonDir)
}
export const gitRaw = (cwd, ...args) => run('git', ['-C', cwd, ...args], { raw: true })
export const verified = (cwd, ref) => git(cwd, 'rev-parse', '--verify', '-q', `${ref}^{commit}`).ok

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

export function worktreeStart(wtPath) {
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

export function mtimeMs(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/**
 * When HEAD last moved — a commit, checkout or reset. Read from the reflog's newest entry, not file
 * times: every `git status` (Orca polls it) rewrites `index`, and gc/reflog expiry rewrites logs/HEAD.
 */
export function gitTouchedAt(wtPath) {
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

export function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** A rebase, merge or cherry-pick under way in the repo (an upstream sync rewriting its base, say). */
export function repoBusy(mainPath) {
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

/**
 * Deletes the removed worktree's branch, only at the tip that was backed up (one that moved meanwhile
 * stays) and only when no other checkout has it out — a forced second checkout or the main one would be
 * left on an unborn HEAD (Codex P1 24.11). True when no such branch is left.
 */
export function deleteBranch(row) {
  if (!row.branch || !verified(row.mainPath, `refs/heads/${row.branch}`)) {
    return true
  }
  const listed = git(row.mainPath, 'worktree', 'list', '--porcelain')
  const usedElsewhere =
    !listed.ok ||
    parseWorktreePorcelain(listed.out).some(
      (wt) => real(wt.path) !== row.path && wt.branch === row.branch
    )
  return (
    !usedElsewhere && git(row.mainPath, 'update-ref', '-d', `refs/heads/${row.branch}`, row.head).ok
  )
}
