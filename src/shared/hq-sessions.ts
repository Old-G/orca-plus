// Custom build (hq-plus-sessions): HQ+'s session dispatcher — given work for a thread, it continues
// the chat already on it, opens a new one seeded with the old one's last report, or queues the work;
// it starts the successor a handoff asked for and closes chats only once their turn is in the journal.
import type { HqChatRole } from './hq-chat-role'

export const HQ_SESSION_DISPATCH_MODES = ['off', 'report', 'on'] as const
export type HqSessionDispatchMode = (typeof HQ_SESSION_DISPATCH_MODES)[number]
// Why report first: the owner reads a day of «would do» before the dispatcher acts on chats.
export const HQ_SESSION_DISPATCH_DEFAULT_MODE: HqSessionDispatchMode = 'report'

export const HQ_SESSION_SOURCE = 'hq-sessions'

/** A chat this full of context is not continued; a new one takes the thread over. */
export const HQ_SESSION_CONTINUE_BELOW_PCT = 60
/** A chat this quiet is not continued either. */
export const HQ_SESSION_QUIET_MS = 12 * 60 * 60_000
/** The owner looked at or typed into a chat this recently: the dispatcher keeps its hands off. */
export const HQ_SESSION_OWNER_IN_MS = 30 * 60_000
/** A handoff the owner has not taken up in this long is started by the dispatcher. */
export const HQ_SESSION_HANDOFF_GRACE_MS = 3 * 60_000
/**
 * Custom build (hq-handoff-auto): with «New chat after a handoff» on, the successor starts this soon,
 * whatever the dispatcher's mode. Why none (owner 24.11): a wait for his click only made him click —
 * the chat on his screen and the 20 s grace left him every start Orca+ was to make by itself.
 */
export const HQ_SESSION_HANDOFF_AUTO_GRACE_MS = 0

/**
 * Custom build (hq-lead-handover, T2): a Lead's chat whose plan now names another live chat is closed this
 * long after its chats moved under the new Lead — time for it to finish a turn the owner may be reading.
 */
export const HQ_SESSION_LEAD_HANDOVER_GRACE_MS = 2 * 60_000
/**
 * Custom build (hq-handoff-once, owner 27.11): an old Lead still mid-turn this long after its chats moved
 * is closed anyway — it was told to stop; one that keeps working beside the new Lead was the bug.
 */
export const HQ_SESSION_LEAD_HANDOVER_MAX_MS = 10 * 60_000

/**
 * Custom build (hq-dispatcher-cleanup, A5 28.11): the sweep closes, to History, chats nobody needs open —
 * parked after a handoff, launched by another chat and quiet this long with a report, or launched and
 * never used. Off leaves them, report only writes «Would close …» rows. Why on (owner 28.11, «чтобы можно
 * было откатить»): the rules touch only finished chats off every plan row; Off is the way back.
 */
export const HQ_DISPATCHER_CLEANUP_MODES = ['off', 'report', 'on'] as const
export type HqDispatcherCleanupMode = (typeof HQ_DISPATCHER_CLEANUP_MODES)[number]
export const HQ_DISPATCHER_CLEANUP_DEFAULT_MODE: HqDispatcherCleanupMode = 'on'
/** A chat another chat launched closes once it is this quiet and its last turn is in the journal. */
export const HQ_CLEANUP_QUIET_MS = 2 * 60 * 60_000
/** A launched chat with no turn closes this long after its launch. */
export const HQ_CLEANUP_EMPTY_MS = 30 * 60_000
/** At most this many closes per sweep. */
export const HQ_CLEANUP_MAX_PER_SWEEP = 5
/** Why a chat is closed: parked after a handoff, quiet with a report, or a launch never used. */
export type HqCleanupReason = 'parked' | 'quiet' | 'empty'

/**
 * Custom build (hq-cold-handoff, L3 28.11, L1 measure №3): a message to a chat this quiet and this full
 * does not wake it — re-reading its whole context costs more than a new chat started from its report.
 * Off by default: messages are delivered as before.
 */
export const HQ_COLD_CHAT_QUIET_MS = 60 * 60_000
export const HQ_COLD_CHAT_MIN_TOKENS = 100_000

/** queued → working → waiting (on the owner) → done → closed (in History). */
export const HQ_SESSION_LIFECYCLE = ['queued', 'working', 'waiting', 'done', 'closed'] as const
export type HqSessionLifecycle = (typeof HQ_SESSION_LIFECYCLE)[number]

/** One chat as the dispatcher sees it now. */
export type HqLiveSession = {
  sessionId: string
  address: string | null
  project: string | null
  workspace: string
  worktreeId: string | null
  name: string | null
  state: Exclude<HqSessionLifecycle, 'queued'>
  /** Its turn has not ended: working, or stopped on a permission prompt for the owner. */
  midTurn: boolean
  lastActivityAt: number
  /** Share of the context window in use; null when unknown. */
  contextPct: number | null
  /** When the owner last had the chat in front of him; null if never seen. */
  ownerAt: number | null
  /** Custom build (hq-handoff-auto): on screen now — its tab is shown and Orca's window has focus. */
  onScreen: boolean
  /** Its tab is open; a closed chat lives in History and is brought back to continue. */
  tabOpen: boolean
  /** Custom build (hq-chat-roles): the role it was launched with; null for a chat launched without one. */
  role: HqChatRole | null
  /**
   * Custom build (hq-handoff-parked, T7): the chat that continues this one after its handoff, the end of
   * the chain. Orca+ sends it nothing more: messages and work for it go there. Absent when none did.
   */
  handedOffTo?: string
}

export type HqDispatchDecision =
  | { kind: 'continue'; address: string; sessionId: string; why: string }
  | { kind: 'new'; address: string; project: string; seedFrom: string | null; why: string }
  | { kind: 'queue'; address: string; why: string }

export type HqDispatchResult = {
  mode: HqSessionDispatchMode
  dryRun: boolean
  decision: HqDispatchDecision
  /** The decision was carried out (mode on, not a dry run). */
  acted: boolean
  sessionId: string | null
  /** The journal row that records it. */
  entryId: string | null
  note: string | null
}

export type HqSweepAction =
  /** A handoff the dispatcher starts (or, in report mode, would). */
  | { kind: 'successor'; offerId: string; sessionId: string; address: string | null; why: string }
  /** Queued work that can go now, and where. */
  | { kind: 'drain'; entryId: string; decision: HqDispatchDecision }
  /** Custom build (hq-lead-handover, T2): the plan's Lead is another live chat; the old Lead's chats move
   *  under it, then the old chat closes. `sameThread`: a handoff on the Lead's own address, nothing to move. */
  | { kind: 'lead-handover'; from: string; to: string; sameThread: boolean; why: string }
  /** Custom build (hq-dispatcher-cleanup, A5): a chat the sweep closes to History (report mode: would). */
  | {
      kind: 'cleanup'
      sessionId: string
      worktreeId: string
      address: string | null
      reason: HqCleanupReason
      why: string
    }
  /** Work handed to a thread no chat is on; only reported. */
  | { kind: 'lost'; address: string; entryIds: string[]; why: string }

export type HqSessionsResult = {
  mode: HqSessionDispatchMode
  dryRun: boolean
  sessions: HqLiveSession[]
  queued: number
  unreviewed: number
  actions: HqSweepAction[]
}

export type HqMayCloseResult = { ok: true } | { ok: false; why: string }
