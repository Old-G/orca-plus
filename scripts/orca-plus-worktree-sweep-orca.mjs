// Custom build (worktree-sweep): what Orca and the system say about a worktree for
// scripts/orca-plus-worktree-sweep.mjs — Orca's worktrees, agents, terminals, tabs and git projects (asked
// through its CLI), and which processes work where (lsof).
import { existsSync } from 'node:fs'
import { isMainCheckout, real, run } from './orca-plus-worktree-sweep-git.mjs'
import { parseLsofCwd } from './orca-plus-worktree-sweep-rules.mjs'

// Why a named CLI: Orca+ runs this from the app and names its bundled `orca`, so the answer comes from the
// app that asked, not from whatever `orca` a login shell puts first (Codex P1 24.11).
export const ORCA_CLI = process.env.ORCA_PLUS_SWEEP_ORCA || 'orca'

function orcaJson(args) {
  const res = run(ORCA_CLI, [...args, '--json'], { timeout: 60_000, killSignal: 'SIGKILL' })
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

const isLocal = (hostId) => !hostId || hostId === 'local'

/**
 * Orca's view of this machine: by real path, each worktree's id, pin, activity, live agents, terminals and
 * open tabs; with `withRepos`, Orca's local git projects. Null when any part is unread or cut short.
 */
export function readOrca(withRepos = true) {
  const list = orcaJson(['worktree', 'list', '--limit', '100000'])
  const ps = orcaJson(['worktree', 'ps', '--limit', '100000'])
  const repoList = withRepos ? orcaJson(['repo', 'list']) : { repos: [] }
  // Why: a cut page hides some worktrees' live agents; a worktree with no row would look idle (Codex P1 10.11).
  if (!list || !ps || !repoList || list.truncated || ps.truncated) {
    return null
  }
  const byPath = new Map()
  const byId = new Map()
  for (const w of list.worktrees) {
    if (!isLocal(w.hostId)) {
      continue
    }
    const path = real(w.path)
    const entry = byPath.get(path) ?? {
      ids: [],
      unread: new Set(),
      pinned: false,
      lastActivityAt: 0,
      liveAgent: false,
      liveTerminal: false,
      isActive: false,
      openTab: false
    }
    entry.ids.push(w.id)
    entry.unread.add(w.id)
    entry.pinned ||= !!w.isPinned
    entry.lastActivityAt = Math.max(entry.lastActivityAt, w.lastActivityAt ?? 0)
    byPath.set(path, entry)
    byId.set(w.id, entry)
  }
  // Why by id on this host, not by path: an SSH row with the same path would overwrite the local row's
  // liveness (Codex P1 24.11). Two rows of one id or path add up: any live one keeps it.
  for (const row of ps.worktrees) {
    const entry = isLocal(row.hostId) ? byId.get(row.worktreeId) : null
    if (!entry) {
      continue
    }
    entry.liveAgent ||= (row.agents ?? []).some((a) => a.state && a.state !== 'done')
    entry.liveTerminal ||=
      (row.liveTerminalCount ?? 0) > 0 ||
      !!row.hasAttachedPty ||
      (row.unverifiableTerminalCount ?? 0) > 0
    entry.isActive ||= !!row.isActive
    // A chat, browser or live terminal tab left open in it (Codex P2 24.11).
    entry.openTab ||= !!row.hasHostSidebarActivity
    entry.unread.delete(row.worktreeId)
  }
  for (const entry of byPath.values()) {
    entry.id = entry.ids.length === 1 ? entry.ids[0] : null
    entry.psRead = entry.unread.size === 0
  }
  // Why each checked: a folder project inside another repo would bring that repo's worktrees (Codex P1 24.11).
  const repos = repoList.repos
    .filter((r) => (r.kind ?? 'git') === 'git' && !r.connectionId && isLocal(r.executionHostId))
    .map((r) => real(r.path))
    .filter((path) => existsSync(path) && isMainCheckout(path))
  return { byPath, repos: [...new Set(repos)] }
}

/** What Orca says keeps a worktree (see keepReasons); `known` is its entry in readOrca().byPath. */
export function orcaEvidence(known, opts) {
  return {
    pinned: known?.pinned ?? false,
    // Why: a chat close is Orca+'s own word on one worktree; one it does not list was not its chat's.
    orcaUnknown: opts.closedChat && !known,
    orcaTwice: !!known && known.id === null,
    // An Orca worktree with no ps row: its agents are unread, so it is not touched.
    orcaUnread: known ? !known.psRead : false,
    liveAgent: known?.liveAgent ?? false,
    liveTerminal: known?.liveTerminal ?? false,
    // Why: after a chat close the owner still has its workspace selected; Orca+ checked no tab is left.
    onScreen: !opts.closedChat && (known?.isActive ?? false),
    openTab: !opts.closedChat && (known?.openTab ?? false)
  }
}

/** Every running process with its working folder; null when lsof cannot tell (then nothing goes). */
export function readProcesses() {
  const res = run('lsof', ['-n', '-P', '-w', '+c', '0', '-d', 'cwd', '-F', 'pcn'], {
    timeout: 60_000
  })
  // lsof exits 1 when it could not read some process; what it did read is still good.
  return /^p\d+/m.test(res.out) ? parseLsofCwd(res.out) : null
}
