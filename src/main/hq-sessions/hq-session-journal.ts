// Custom build (hq-plus-sessions): what the dispatcher needs from Orca+, and how it writes its
// moves into the HQ+ journal — one row per move, deduplicated so a repeated sweep adds nothing.
import { createHash } from 'node:crypto'
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  HQ_JOURNAL_MAX_LIMIT,
  hqJournalTitle,
  type HqChatSendResult,
  type HqJournalEntry,
  type HqJournalInput,
  type HqJournalQuery,
  type HqJournalRecordResult,
  type HqSession,
  type HqSessionInput
} from '../../shared/hq-journal'
import {
  HQ_SESSION_SOURCE,
  type HqDispatchDecision,
  type HqLiveSession,
  type HqSessionDispatchMode
} from '../../shared/hq-sessions'
import type { HqBackgroundChatLaunch } from '../hq-today/hq-background-chat'
import type { HqCaller, HqCallerScope } from '../hq-journal/hq-journal-rooms'

export type HqHandoffOfferRef = {
  id: string
  /** The chat that wrote the handoff; null when the offer does not say. */
  sessionId: string | null
  raisedAt: number
}

export type HqSessionsDeps = {
  mode: () => HqSessionDispatchMode
  /** The HQ+ journal switch; off, nothing is recorded or acted on. */
  enabled: () => boolean
  scope: (caller: HqCaller) => Promise<HqCallerScope>
  /** The room a project belongs to. */
  roomOf: (project: string) => Promise<string>
  /** How the dispatcher itself calls the thread tools: as HQ+, which may reach every room. */
  dispatcherCaller: () => HqCaller
  pulse: {
    list: (query: HqJournalQuery) => HqJournalEntry[]
    record: (inputs: readonly HqJournalInput[]) => HqJournalRecordResult
    noteSessions: (inputs: readonly HqSessionInput[]) => number
    getSession: (sessionId: string) => HqSession | null
  }
  /** Every chat now; the context share is read only for chats on `addresses`. */
  live: (addresses?: readonly string[]) => Promise<HqLiveSession[]>
  /** `orca chat send`: into the thread's chat, bringing a closed one back. */
  send: (caller: HqCaller, message: { address: string; text: string }) => Promise<HqChatSendResult>
  /** Where a new chat for the project opens: the old chat's workspace when given and still there. */
  workspaceFor: (
    project: string,
    worktreeId: string | null
  ) => Promise<{ worktreeId: string; name: string } | null>
  launch: (worktreeId: string) => Promise<HqBackgroundChatLaunch>
  limit: (sessionId: string) => Promise<boolean>
  nameChat: (sessionId: string, name: string) => Promise<void>
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  offers: () => readonly HqHandoffOfferRef[]
  startHandoff: (offerId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Brings the journal up to date (finished turns become reports). */
  sync: () => Promise<void>
  now: () => number
  log: (message: string) => void
}

/** A short stable key for a piece of work, so the same work queued twice is one row. */
export function hqWorkKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

export function describeHqDispatch(decision: HqDispatchDecision): string {
  switch (decision.kind) {
    case 'continue':
      return `continue ${decision.address} in its chat — ${decision.why}`
    case 'new':
      return `open a new chat for ${decision.address}${decision.seedFrom ? ' seeded from the last one' : ''} — ${decision.why}`
    case 'queue':
      return `queue the work for ${decision.address} — ${decision.why}`
  }
}

export type HqSessionJournal = ReturnType<typeof createHqSessionJournal>

export function createHqSessionJournal(deps: Pick<HqSessionsDeps, 'pulse' | 'roomOf'>) {
  const row = (input: Omit<HqJournalInput, 'source' | 'replyTo' | 'personId'>): HqJournalInput => ({
    ...input,
    personId: null,
    replyTo: null,
    source: HQ_SESSION_SOURCE
  })

  const recorded = (dedupeKey: string): HqJournalEntry | null =>
    deps.pulse
      .list({ source: HQ_SESSION_SOURCE, limit: HQ_JOURNAL_MAX_LIMIT })
      .find((entry) => entry.dedupeKey === dedupeKey) ?? null

  return {
    row,
    recorded,
    /** Questions to the owner still open (`chat.report` needing `owner:*`). */
    unreviewed: (): number =>
      deps.pulse.list({
        kind: HQ_JOURNAL_KIND.chatReport,
        needs: 'owner',
        status: 'open',
        limit: HQ_JOURNAL_MAX_LIMIT
      }).length,
    lastReport: (sessionId: string): HqJournalEntry | null =>
      deps.pulse.list({ kind: HQ_JOURNAL_KIND.chatReport, sessionId, limit: 1 })[0] ?? null,
    /** Report mode: what the dispatcher would do, once per key. */
    async plan(
      title: string,
      project: string | null,
      address: string | null,
      dedupeKey: string
    ): Promise<string | null> {
      const known = recorded(dedupeKey)
      if (known) {
        return known.id
      }
      deps.pulse.record([
        row({
          workspace: project ? await deps.roomOf(project) : HQ_JOURNAL_ALL_ROOMS,
          kind: HQ_JOURNAL_KIND.sessionPlan,
          project,
          address,
          sessionId: null,
          title: hqJournalTitle(`Would ${title}`),
          needs: 'nobody',
          status: 'done',
          refKind: null,
          refId: null,
          dedupeKey
        })
      ])
      return recorded(dedupeKey)?.id ?? null
    }
  }
}
