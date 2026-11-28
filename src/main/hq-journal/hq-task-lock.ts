// Custom build (hq-task-lock, A3 28.11): the lock on a plan row that `orca agent launch` and
// `orca worktree create --agent` take before starting a worker. The holder is a chat; it holds the row
// while its chat (followed through handoffs) is open. A launch is three calls — claim, then bind the
// started chat, or release on failure — and a claimed row stays «starting» until then, so two launches
// a second apart cannot both pass. Same notion of «open» as `orca chat send` (A2): the open chat tabs.
import { randomUUID } from 'node:crypto'
import type { HqSession } from '../../shared/hq-journal'
import type { HqTaskClaimResult, HqTaskHolder, HqTaskKey } from '../../shared/hq-task-lock'

export type HqTaskLockStore = {
  taskLockOf: (key: HqTaskKey) => { sessionId: string; at: number } | null
  setTaskLock: (lock: HqTaskKey & { sessionId: string; at: number }) => void
}

export type HqTaskLockDeps = {
  store: () => HqTaskLockStore
  getSession: (sessionId: string) => HqSession | null
  liveSessionOf?: (sessionId: string) => string
  /** The chats with a tab open; null when they could not be read (then the journal's closedAt decides). */
  openTabs?: () => ReadonlySet<string> | null
  now?: () => number
}

export type HqTaskLock = {
  claim: (ask: HqTaskKey & { callerSessionId: string | null }) => HqTaskClaimResult
  bind: (ask: HqTaskKey & { ticket: string; sessionId: string }) => { bound: boolean }
  release: (ask: HqTaskKey & { ticket: string }) => { released: boolean }
}

// Why 10 min: a worktree create runs setup before the chat starts; a CLI that died mid-launch frees
// the row after this, and `--task none` skips it sooner.
export const HQ_TASK_STARTING_MS = 10 * 60_000

// Why 6 h: a worker the journal never saw is new; an old lock of one is no reason to refuse.
export const HQ_TASK_UNSEEN_HOLDER_MS = 6 * 60 * 60_000

type Starting = { ticket: string; at: number; callerSessionId: string | null }

function keyOf(key: HqTaskKey): string {
  return `${key.plan}\u0000${key.row}`
}

export function createHqTaskLock(deps: HqTaskLockDeps): HqTaskLock {
  const now = deps.now ?? Date.now
  const starting = new Map<string, Starting>()
  const live = (sessionId: string): string => deps.liveSessionOf?.(sessionId) ?? sessionId
  const holderOf = (sessionId: string): HqTaskHolder => {
    const session = deps.getSession(sessionId)
    return { sessionId, address: session?.address ?? null, state: session?.state ?? null }
  }

  // Why the journal's closedAt stands in for the tabs: just after a restart the tabs read as none, and
  // that is when a Lead relaunches its workers. A holder the journal has not seen yet counts as open
  // for a while after it took the row (review A3).
  const isOpen = (sessionId: string, heldAt: number): boolean => {
    const open = deps.openTabs?.() ?? null
    if (open) {
      return open.has(sessionId)
    }
    const session = deps.getSession(sessionId)
    return session ? session.closedAt === null : now() - heldAt < HQ_TASK_UNSEEN_HOLDER_MS
  }

  const pendingOf = (key: HqTaskKey): Starting | null => {
    const pending = starting.get(keyOf(key))
    if (pending && now() - pending.at > HQ_TASK_STARTING_MS) {
      starting.delete(keyOf(key))
      return null
    }
    return pending ?? null
  }

  return {
    claim: ({ callerSessionId, ...key }) => {
      const caller = callerSessionId ? live(callerSessionId) : null
      const pending = pendingOf(key)
      // Why even the same caller is refused: a Lead sending one brief twice is the duplicate this
      // stops; a lost reply is retried with --retry-launch, which claims nothing.
      if (pending) {
        return {
          taken: false,
          reason: 'starting',
          holder: pending.callerSessionId ? holderOf(pending.callerSessionId) : null,
          since: pending.at
        }
      }
      const held = deps.store().taskLockOf(key)
      let movedFrom: HqTaskHolder | undefined
      if (held) {
        const holder = live(held.sessionId)
        // Why the caller may take its own row: a worker starts the next chat of its chain (skill lead).
        const own = caller !== null && holder === caller
        if (isOpen(holder, held.at) && !own) {
          return { taken: false, reason: 'open', holder: holderOf(holder) }
        }
        movedFrom = holderOf(holder)
      }
      const ticket = randomUUID()
      starting.set(keyOf(key), { ticket, at: now(), callerSessionId })
      return { taken: true, ticket, ...(movedFrom ? { movedFrom } : {}) }
    },
    bind: ({ ticket, sessionId, ...key }) => {
      const pending = pendingOf(key)
      // Why a lapsed ticket still binds when nobody else claimed: the chat did start on this row.
      if (pending && pending.ticket !== ticket) {
        return { bound: false }
      }
      starting.delete(keyOf(key))
      deps.store().setTaskLock({ ...key, sessionId, at: now() })
      return { bound: true }
    },
    release: ({ ticket, ...key }) => {
      const pending = pendingOf(key)
      if (!pending || pending.ticket !== ticket) {
        return { released: false }
      }
      starting.delete(keyOf(key))
      return { released: true }
    }
  }
}

let provided: HqTaskLock | null = null

export function provideHqTaskLock(lock: HqTaskLock | null): void {
  provided = lock
}

export function getHqTaskLock(): HqTaskLock | null {
  return provided
}
