// Custom build (hq-plus-sessions): HQ+'s session dispatcher — given work for a thread, it continues
// the chat already on it, opens a new one seeded with the old one's last report, or queues the work;
// it starts the successor a handoff asked for and closes chats only once their turn is in the journal.

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
  /** Its tab is open; a closed chat lives in History and is brought back to continue. */
  tabOpen: boolean
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
