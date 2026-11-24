// Custom build (worktree-sweep): a chat the owner closes takes its worktree with it once the work there is
// finished. Orca+ runs scripts/orca-plus-worktree-sweep.mjs --closed-chat on it: the nightly sweep's proofs
// (no live agent, terminal or process in it, nothing uncommitted, every commit in the base branch, the tip
// kept 30 days as a ref) without the night's day of quiet. A worktree with another tab still open is not
// touched; one the sweep keeps stays, and the night's report in HQ → Reports names why.
// Why no Electron here: the runtime's tab-close code calls in, and that code is bundled into orcad too;
// register-chat-close-worktree-sweep.ts gives the app's half.
import type { StructuredSessionSurface } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'
import { splitWorktreeId } from '../../../shared/worktree/id'

// Why: the closed chat's provider exits and its tab bookkeeping settles first; a tab opened in the
// worktree meanwhile keeps it.
export const CHAT_CLOSE_SWEEP_DELAY_MS = 15_000

export type ChatCloseSweepDeps = {
  enabled: () => boolean
  /** The repo's main checkout: never swept. */
  isMainCheckout: (repoId: string, worktreePath: string) => boolean
  /** Tabs still open in the worktree, the closed chat's own left out. */
  openTabs: (worktreeId: string, closedSessionId: string) => number
  /** The chat still runs without its tab (a bot's thread). */
  stillRunning: (sessionId: string) => boolean
  /** The sweep's stdout, or null when it could not run. */
  runSweep: (args: readonly string[]) => Promise<string | null>
  log: (message: string, detail: Record<string, unknown>) => void
  delayMs: number
}

export type ChatCloseSweepOutcome =
  | { kind: 'removed'; backup: string | null }
  | { kind: 'kept'; reasons: string[] }
  | { kind: 'skipped'; why: string }

let current: ChatCloseSweepDeps | null = null
const pending = new Map<string, ReturnType<typeof setTimeout>>()

export function provideChatCloseWorktreeSweep(deps: ChatCloseSweepDeps | null): void {
  current = deps
}

/** Called once the owner closed a chat's tab; sweeps its worktree a little later. */
export function sweepWorktreeAfterChatClose(
  sessionId: string,
  surface: StructuredSessionSurface | null
): void {
  const deps = current
  const worktreeId = surface?.presentation?.raw?.worktreeId
  if (!deps || !worktreeId) {
    return
  }
  try {
    if (!deps.enabled()) {
      return
    }
  } catch {
    return
  }
  clearTimeout(pending.get(worktreeId))
  const timer = setTimeout(() => {
    pending.delete(worktreeId)
    void sweepClosedChatWorktree(deps, sessionId, worktreeId)
      .then((outcome) => deps.log(outcome.kind, { worktreeId, ...outcome }))
      .catch((error: unknown) =>
        deps.log('failed', { worktreeId, error: error instanceof Error ? error.message : error })
      )
  }, deps.delayMs)
  timer.unref?.()
  pending.set(worktreeId, timer)
}

type SweepJson = {
  rows?: { path?: string; reasons?: string[]; remove?: boolean }[]
  results?: { path?: string; result?: { ok?: boolean; backup?: string; step?: string } }[]
}

/** Reads the sweep's JSON for the one worktree it was asked about. */
export function readSweepOutcome(stdout: string, worktreePath: string): ChatCloseSweepOutcome {
  let parsed: SweepJson
  try {
    parsed = JSON.parse(stdout) as SweepJson
  } catch {
    return { kind: 'skipped', why: 'unreadable sweep output' }
  }
  const result = parsed.results?.[0]?.result
  if (result?.ok) {
    return { kind: 'removed', backup: result.backup ?? null }
  }
  if (result && !result.ok) {
    return { kind: 'kept', reasons: [`removal failed at ${result.step ?? 'an unknown step'}`] }
  }
  const row = parsed.rows?.[0]
  if (!row) {
    return { kind: 'skipped', why: `not a linked worktree git knows: ${worktreePath}` }
  }
  return { kind: 'kept', reasons: row.reasons ?? [] }
}

export async function sweepClosedChatWorktree(
  deps: ChatCloseSweepDeps,
  sessionId: string,
  worktreeId: string
): Promise<ChatCloseSweepOutcome> {
  const parsed = splitWorktreeId(worktreeId)
  if (!parsed) {
    return { kind: 'skipped', why: 'not a repo worktree' }
  }
  if (deps.isMainCheckout(parsed.repoId, parsed.worktreePath)) {
    return { kind: 'skipped', why: 'main checkout' }
  }
  if (deps.stillRunning(sessionId)) {
    return { kind: 'skipped', why: 'the chat still runs' }
  }
  const tabs = deps.openTabs(worktreeId, sessionId)
  if (tabs > 0) {
    return { kind: 'skipped', why: `${tabs} other tab(s) open in it` }
  }
  const stdout = await deps.runSweep([
    '--worktree',
    parsed.worktreePath,
    '--closed-chat',
    '--fetch',
    '--apply',
    '--json'
  ])
  return stdout === null
    ? { kind: 'skipped', why: 'the sweep did not run' }
    : readSweepOutcome(stdout, parsed.worktreePath)
}
