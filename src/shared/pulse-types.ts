// Custom build (pulse): the records behind Orca+'s headquarters view — who waits on whom, what was decided,
// what an agent wants to send, and what the bell shows. Shared by main, RPC and the renderer;
// fields added later must stay optional (docs/reference/remote-wire-compatibility.md).

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
}

export type PulseEntity = 'person' | 'waiting' | 'draft' | 'decision' | 'inbox'

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
