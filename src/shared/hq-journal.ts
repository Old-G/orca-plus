// Custom build (hq-plus-journal): HQ+'s event journal — one record per thing that happened, each
// saying which room (HQ space) it belongs to and whose move it is next (`needs`). Agents read it
// through `orca hq events`; the stores it points at (waitings, drafts, decisions, inbox) stay as they are.

/** Events of HQ+ itself, above the rooms. */
export const HQ_JOURNAL_ALL_ROOMS = '_all'
/** A record whose project no room claims; HQ+ asks the owner once where it belongs. */
export const HQ_JOURNAL_UNASSIGNED = '_unassigned'

export const HQ_JOURNAL_STATUSES = ['open', 'done', 'dropped'] as const
export type HqJournalStatus = (typeof HQ_JOURNAL_STATUSES)[number]

export const HQ_JOURNAL_TITLE_MAX = 140
export const HQ_JOURNAL_BODY_MAX = 4096

export const HQ_JOURNAL_KIND = {
  waitingOpen: 'waiting.open',
  waitingDone: 'waiting.done',
  approveRequest: 'approve.request',
  approveResult: 'approve.result',
  chatReport: 'chat.report',
  personReply: 'person.reply',
  reviewFinding: 'review.finding',
  crossRead: 'cross-read'
} as const

/** Who moves next: `nobody`, the owner (`owner:decide|approve|reply`), an agent (`agent:<address>`,
 *  `agent:new`) or a person (`person:<id>`). */
const NEEDS = /^(?:nobody|owner:(?:decide|approve|reply)|agent:\S{1,200}|person:\S{1,200})$/

export function isHqJournalNeeds(value: string): boolean {
  return NEEDS.test(value)
}

/** `--needs owner` matches every `owner:*`; a full value matches only itself. */
export const HQ_JOURNAL_NEEDS_PARTIES = ['nobody', 'owner', 'agent', 'person'] as const
export type HqJournalNeedsParty = (typeof HQ_JOURNAL_NEEDS_PARTIES)[number]

export type HqJournalLink = {
  kind: 'mr' | 'commit' | 'clickup' | 'slack' | 'artifact' | 'file' | 'url'
  url?: string
  id?: string
}

export type HqJournalEntry = {
  /** `e-<uuid>`. */
  id: string
  at: number
  /** The room's slug, HQ_JOURNAL_ALL_ROOMS or HQ_JOURNAL_UNASSIGNED. */
  workspace: string
  kind: string
  project: string | null
  /** The thread's `<project>/<task>`, once one is known. */
  address: string | null
  sessionId: string | null
  personId: string | null
  /** One line, at most HQ_JOURNAL_TITLE_MAX. */
  title: string
  body: string | null
  needs: string
  status: HqJournalStatus
  replyTo: string | null
  refKind: string | null
  refId: string | null
  links: HqJournalLink[]
  /** Who wrote it: `approve-gate`, `slack-reader`, `codex-review`, `hq-plus`… */
  source: string
  dedupeKey: string | null
}

export type HqJournalInput = Omit<HqJournalEntry, 'id' | 'at' | 'status' | 'links' | 'body'> & {
  at?: number
  status?: HqJournalStatus
  links?: HqJournalLink[]
  body?: string | null
  /** How sure the source is of the room: `firm` (a room claims it) moves a row placed elsewhere,
   *  `fallback` moves only a row nobody had placed; absent, a written row never moves. */
  placement?: 'firm' | 'fallback'
  /** One open row per kind and ref: this one settles the ref's older open rows of its kind. */
  supersedes?: boolean
}

export type HqJournalRecordResult = { added: number; settled: number; moved: number }

/** What a journal read returns to a caller that may see every room: no bodies, no links. */
export type HqJournalHeader = Pick<
  HqJournalEntry,
  'id' | 'at' | 'workspace' | 'kind' | 'project' | 'address' | 'title' | 'needs' | 'status'
>

export type HqJournalQuery = {
  /** Only these rooms; absent = every room. */
  workspaces?: readonly string[]
  since?: number
  project?: string
  /** A party (`owner`) or one exact value (`owner:approve`). */
  needs?: string
  status?: HqJournalStatus
  /** One kind, or a family with a trailing `*` (`approve.*`). */
  kind?: string
  limit?: number
}

/** `hq.events`: HQ+ gets every room's headings; a room's chat gets its room's whole entries. */
export type HqEventsResult =
  | { scope: 'overview'; headers: HqJournalHeader[] }
  | { scope: 'room'; room: string; roomName: string | null; entries: HqJournalEntry[] }

/** `hq.whoami`: where the calling chat works. */
export type HqWhoami = {
  sessionId: string | null
  /** A chat in the HQ repo: HQ+, which sees every room's headings. */
  overview: boolean
  room: string | null
  roomName: string | null
  project: string | null
  address: string | null
  task: string | null
  worktreeId: string | null
}

export const HQ_JOURNAL_DEFAULT_LIMIT = 50
export const HQ_JOURNAL_MAX_LIMIT = 500

export const HQ_SESSION_STATES = ['queued', 'working', 'waiting', 'done', 'closed'] as const
export type HqSessionState = (typeof HQ_SESSION_STATES)[number]

/** One agent chat and the thread it works on. */
export type HqSession = {
  sessionId: string
  address: string | null
  agent: string | null
  worktreeId: string | null
  workspace: string
  project: string | null
  state: HqSessionState
  contextPct: number | null
  openedAt: number
  lastActivityAt: number
  closedAt: number | null
  parentSessionId: string | null
  taskRef: string | null
}

/** A sighting of the session at `at`; fields left null keep what is known. */
export type HqSessionInput = Omit<HqSession, 'openedAt' | 'lastActivityAt' | 'closedAt'> & {
  at: number
}

/** A journal title: one line, at most HQ_JOURNAL_TITLE_MAX. */
export function hqJournalTitle(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length > HQ_JOURNAL_TITLE_MAX
    ? `${line.slice(0, HQ_JOURNAL_TITLE_MAX - 1).trimEnd()}…`
    : line
}

export function hqJournalBody(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text.slice(0, HQ_JOURNAL_BODY_MAX) : null
}

const SINCE_UNIT_MS: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000
}

/** `24h`, `90m`, `7d`, `2w` or an ISO date → epoch ms; null when it is neither. */
export function parseHqJournalSince(value: string, now: number): number | null {
  const relative = /^(\d{1,5})([mhdw])$/.exec(value.trim())
  const unit = relative ? SINCE_UNIT_MS[relative[2] ?? ''] : undefined
  if (relative && unit) {
    return now - Number(relative[1]) * unit
  }
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : at
}
