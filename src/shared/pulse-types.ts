// Custom build (pulse): the records behind Orca+'s headquarters view — who waits on whom, what was decided,
// what an agent wants to send, and what the bell shows. Shared by main, RPC and the renderer;
// fields added later must stay optional (docs/reference/remote-wire-compatibility.md).
import type { OutgoingDraftCall } from './outgoing-approval/outgoing-action'
import type { OutgoingSentContext } from './outgoing-approval/outgoing-sent-context'

export type PulsePerson = {
  id: string
  name: string
  slackUserId: string | null
  clickupUserId: string | null
  role: string | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export type PulsePersonInput = {
  /** Updates that person; otherwise the Slack or ClickUp id finds an existing one. */
  id?: string
  name: string
  slackUserId?: string | null
  clickupUserId?: string | null
  role?: string | null
  notes?: string | null
}

/** `on-me`: someone waits for me to act. `on-them`: I wait for someone. */
export type PulseWaitingDirection = 'on-me' | 'on-them'
export type PulseWaitingStatus = 'open' | 'resolved' | 'cancelled'

export type PulseWaiting = {
  id: string
  direction: PulseWaitingDirection
  personId: string | null
  /** HQ project slug. */
  project: string | null
  title: string
  detail: string | null
  /** Who recorded it: `agent`, `slack`, `clickup`, `manual`… */
  source: string
  sourceRef: string | null
  status: PulseWaitingStatus
  dueAt: number | null
  resolution: string | null
  createdAt: number
  resolvedAt: number | null
  /** Custom build (hq-waiting-replies): the agent chat that waits, so an answer can reach it. */
  agentSessionId: string | null
  paneKey: string | null
  worktreeId: string | null
  /** The person's latest answer, as the Slack scout found it. */
  reply: string | null
  replyAuthor: string | null
  /** Slack ts of that answer; a later one replaces it. */
  replyTs: string | null
  repliedAt: number | null
  /** When the answer was handed to the waiting chat; null while it was not. */
  replyDeliveredAt: number | null
  /** Custom build (hq-reply-source-link): where the answer was said, when known. */
  replyLink?: string | null
  /** Custom build (hq-plus-person-replies): the Slack / ClickUp user id that said the whole answer;
   *  null when unknown or when several people's messages make it up. */
  replyAuthorId?: string | null
}

export type PulseWaitingReply = {
  text: string
  author: string | null
  ts: string
  link?: string | null
  /** Custom build (hq-plus-person-replies): the one user id behind every message of the answer. */
  authorId?: string | null
  /** Custom build (hq-plus-cards): the owner's message the answer replies to; kept as the waiting's
   *  detail when it has none, so the card can show what was asked. */
  asked?: string | null
}

export type PulseWaitingInput = {
  direction: PulseWaitingDirection
  title: string
  personId?: string | null
  project?: string | null
  detail?: string | null
  source: string
  sourceRef?: string | null
  dueAt?: number | null
  agentSessionId?: string | null
  paneKey?: string | null
  worktreeId?: string | null
  /** Custom build (hq-notes-dedup): add even when an open waiting already says the same. */
  allowDuplicate?: boolean
}

/** What adding returns: the new waiting, or the open one that already says the same (`duplicate`). */
export type PulseWaitingAdded = PulseWaiting & { duplicate?: boolean }

/** Custom build (hq-notes-dedup): what an update may change; omitted fields stay. */
export type PulseWaitingPatch = {
  title?: string
  detail?: string | null
  dueAt?: number | null
}

export type PulseWaitingFilter = {
  status?: PulseWaitingStatus
  direction?: PulseWaitingDirection
  personId?: string
  project?: string
}

export type PulseDraftKind = 'message' | 'clickup-task' | 'clickup-comment' | 'other'
export type PulseDraftStatus = 'pending' | 'approved' | 'rejected' | 'sent' | 'failed'

export type PulseDraft = {
  id: string
  kind: PulseDraftKind
  /** Where it goes: a Slack user or channel, a ClickUp list or task. */
  target: string | null
  title: string | null
  body: string
  project: string | null
  personId: string | null
  source: string
  sourceRef: string | null
  /** Same kind + fingerprint = the same draft, whatever its status — a rejected one never returns. */
  fingerprint: string | null
  status: PulseDraftStatus
  createdAt: number
  updatedAt: number
  /** Custom build (outgoing-approval): the agent tool call a gate draft holds. */
  call?: OutgoingDraftCall | null
}

export type PulseDraftInput = {
  kind: PulseDraftKind
  body: string
  target?: string | null
  title?: string | null
  project?: string | null
  personId?: string | null
  source: string
  sourceRef?: string | null
  fingerprint?: string | null
  call?: OutgoingDraftCall | null
}

export type PulseDecisionKind = 'decision' | 'approval'
export type PulseApprovalOutcome = 'approved' | 'edited' | 'rejected'

export type PulseDecision = {
  id: string
  kind: PulseDecisionKind
  title: string
  body: string | null
  /** Set exactly for approvals. */
  outcome: PulseApprovalOutcome | null
  project: string | null
  personId: string | null
  draftId: string | null
  source: string
  decidedAt: number
  /** HQ file the decision was mirrored to, once it is. */
  mirroredPath: string | null
  /** Custom build (hq-sent-history): for an approval, where the call went and who sent it. */
  sentContext: OutgoingSentContext | null
}

export type PulseDecisionInput = {
  title: string
  body?: string | null
  project?: string | null
  personId?: string | null
  source: string
}

export type PulseInboxUrgency = 'normal' | 'urgent'

export type PulseInboxAction = { id: string; label: string }

export type PulseInboxItem = {
  id: string
  /** `decision`, `review`, `blocked-agent`, `report-preview`, `handoff`, `limit`… */
  kind: string
  title: string
  body: string | null
  urgency: PulseInboxUrgency
  refKind: string | null
  refId: string | null
  actions: PulseInboxAction[]
  /** While an item with this key is not done, adding another returns it instead. */
  dedupeKey: string | null
  createdAt: number
  readAt: number | null
  doneAt: number | null
  doneAction: string | null
}

export type PulseInboxInput = {
  kind: string
  title: string
  body?: string | null
  urgency?: PulseInboxUrgency
  refKind?: string | null
  refId?: string | null
  actions?: PulseInboxAction[]
  dedupeKey?: string | null
  /** Custom build (hq-reply-in-place): an open item of the same kind whose dedupe key starts with this
   *  becomes the new one — same card, new words, moved to now — instead of closing for a second one. */
  replaces?: string | null
}

// Custom build (hq-plus-journal): journal rows follow the same change feed.
export type PulseEntity = 'person' | 'waiting' | 'draft' | 'decision' | 'inbox' | 'journal'

export type PulseEvent = {
  /** Strictly increasing; a reader resumes from the last seq it saw. */
  seq: number
  at: number
  /** `<entity>.<verb>`, e.g. `waiting.added`, `draft.decided`. */
  kind: string
  entity: PulseEntity
  entityId: string
  /** The record as it is after the change. */
  payload: unknown
}

export type PulseAddResult<T> = { record: T; created: boolean }
