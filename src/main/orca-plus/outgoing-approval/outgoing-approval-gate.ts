// Custom build (outgoing-approval): holds an agent's outgoing tool call as a pulse draft until the owner
// approves, edits or rejects it in the bell, then answers the waiting PreToolUse hook. Decisions come only
// from the renderer's IPC — never from the hook server, whose token every agent can read.
import { classifyOutgoingToolCall } from '../../../shared/outgoing-approval/outgoing-action-classifier'
import type { OutgoingDraftCall } from '../../../shared/outgoing-approval/outgoing-action'
import type { OutgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import { withOutgoingFooter } from '../../../shared/outgoing-approval/outgoing-footer'
import { outgoingWaitingFollowUp } from '../../../shared/outgoing-approval/outgoing-waiting-prompt'
import type { PulseApprovalOutcome, PulseDraft } from '../../../shared/pulse-types'
import type { PulseDb } from '../pulse/pulse-db'

export const GATE_DRAFT_SOURCE = 'gate'

export type GateHookOutput = { hookSpecificOutput: Record<string, unknown> }

export type GateReply =
  | { state: 'pass' }
  | { state: 'pending'; id: string }
  | { state: 'final'; output: GateHookOutput }

/** Custom build (outgoing-footer): what the owner's answer adds to the call it releases. */
export type GateRelease = {
  /** Appended to the call's text field. */
  footer?: string | null
  /** Custom build (outgoing-venue): a Slack thread the message goes into instead of the channel. */
  threadTs?: string | null
  /** A rejection that tells the agent where to send the text instead. */
  denyReason?: string | null
}

export type GateSubmission = {
  /** The PreToolUse payload Claude piped to the hook. */
  hook: unknown
  agent: string
  paneKey: string | null
  agentSessionId: string | null
}

type GateDeps = {
  db: () => PulseDb
  now?: () => number
  /** How long one wait request is held before the hook asks again. */
  holdMs?: number
  /** A pending call nobody has polled for this long belongs to a hook that is gone. */
  abandonAfterMs?: number
  onChanged?: () => void
}

const DEFAULT_HOLD_MS = 25_000
const DEFAULT_ABANDON_AFTER_MS = 120_000

const REJECTED_REASON =
  'The user rejected this outgoing action in the Orca+ bell. Do not retry it; ask the user what to do instead.'
const ABANDONED_REASON =
  'Orca+ dropped this held action because its hook stopped asking for a decision, so it was not approved. Ask the user before trying again.'
const UNKNOWN_REASON =
  'Orca+ has no record of this held action, so it was not approved. Ask the user before trying again.'

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function stringField(value: unknown, key: string): string | null {
  const read = field(value, key)
  return typeof read === 'string' && read ? read : null
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function preToolUse(
  decision: 'allow' | 'deny',
  reason: string,
  updatedInput?: Record<string, unknown>,
  additionalContext?: string | null
) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
      ...(updatedInput ? { updatedInput } : {}),
      // Custom build (hq-waiting-replies): the allow reason reaches only the user; this reaches the model.
      ...(additionalContext ? { additionalContext } : {})
    }
  }
}

/** The input the approved call runs with: the original, or with the edited text (and footer) in its field. */
export function approvedToolInput(
  draft: PulseDraft,
  call: OutgoingDraftCall,
  release: GateRelease = {}
): Record<string, unknown> | null {
  const input = { ...call.toolInput }
  if (call.editField) {
    input[call.editField] = withOutgoingFooter(draft.body, release.footer ?? null)
  }
  if (release.threadTs) {
    input.thread_ts = release.threadTs
  }
  const changed = Object.keys(input).some((key) => input[key] !== call.toolInput[key])
  return changed ? input : null
}

export class OutgoingApprovalGate {
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly lastSeen = new Map<string, number>()
  // Why: a dropped card must not read to the agent as the owner's rejection.
  private readonly abandoned = new Set<string>()
  // Why: held until the hook takes its answer; a restart in between sends the call as approved, bare.
  private readonly releases = new Map<string, GateRelease>()
  private lastSweepAt: number
  private readonly now: () => number
  private readonly holdMs: number
  private readonly abandonAfterMs: number
  private readonly startedAt: number

  constructor(private readonly deps: GateDeps) {
    this.now = deps.now ?? Date.now
    this.holdMs = deps.holdMs ?? DEFAULT_HOLD_MS
    this.abandonAfterMs = deps.abandonAfterMs ?? DEFAULT_ABANDON_AFTER_MS
    this.startedAt = this.now()
    this.lastSweepAt = this.startedAt
  }

  submit(submission: GateSubmission): GateReply {
    const { hook } = submission
    const toolName = stringField(hook, 'tool_name')
    const toolInput = plainObject(field(hook, 'tool_input'))
    if (stringField(hook, 'hook_event_name') !== 'PreToolUse' || !toolName || !toolInput) {
      return { state: 'pass' }
    }
    const cwd = stringField(hook, 'cwd')
    const action = classifyOutgoingToolCall(toolName, toolInput)
    if (!action) {
      return { state: 'pass' }
    }
    const sessionId = stringField(hook, 'session_id')
    const toolUseId = stringField(hook, 'tool_use_id')
    const call: OutgoingDraftCall = {
      agent: submission.agent,
      toolName,
      toolInput,
      toolUseId,
      sessionId,
      cwd,
      paneKey: submission.paneKey,
      agentSessionId: submission.agentSessionId,
      service: action.service,
      operation: action.operation,
      editField: action.editField
    }
    const { record, created } = this.deps.db().addDraft({
      kind: action.draftKind,
      target: action.target,
      title: `${action.service} · ${action.operation}`,
      body: action.body,
      source: GATE_DRAFT_SOURCE,
      sourceRef: call.cwd,
      // Why: a hook re-submitting the same tool call after a reconnect finds its draft, not a new card.
      fingerprint: toolUseId ? `gate:${sessionId ?? ''}:${toolUseId}` : null,
      call
    })
    this.lastSeen.set(record.id, this.now())
    if (created) {
      this.deps.onChanged?.()
    }
    return this.replyFor(record)
  }

  async wait(id: string): Promise<GateReply> {
    const db = this.deps.db()
    let draft = db.getDraft(id)
    if (!draft?.call || draft.source !== GATE_DRAFT_SOURCE) {
      return { state: 'final', output: preToolUse('deny', UNKNOWN_REASON) }
    }
    this.lastSeen.set(id, this.now())
    if (draft.status === 'pending') {
      await this.waitForChange(id)
      draft = db.getDraft(id) ?? draft
      this.lastSeen.set(id, this.now())
    }
    return this.replyFor(draft)
  }

  /** The owner's answer from the bell; `editedText` replaces the call's editable field.
   *  `describe` names where the call goes and who sends it, kept with the decision. */
  decide(
    id: string,
    outcome: PulseApprovalOutcome,
    editedText?: string,
    describe?: (draft: PulseDraft) => OutgoingSentContext,
    release?: GateRelease
  ): PulseDraft {
    const db = this.deps.db()
    const draft = db.getDraft(id)
    if (!draft?.call || draft.source !== GATE_DRAFT_SOURCE) {
      throw new Error(`outgoing-approval: ${id} is not a held call`)
    }
    if (outcome === 'edited' && !draft.call.editField) {
      throw new Error(`outgoing-approval: ${id} has no editable text`)
    }
    const { draft: decided } = db.decideDraft(
      id,
      outcome,
      outcome === 'edited' ? editedText : undefined,
      describe?.(draft) ?? null
    )
    if (release) {
      this.releases.set(id, release)
    }
    this.release(id)
    return decided
  }

  pending(): PulseDraft[] {
    return this.deps
      .db()
      .listDrafts('pending')
      .filter((draft) => draft.source === GATE_DRAFT_SOURCE && draft.call)
  }

  /** Drops pending calls whose hook stopped asking — the agent was interrupted or its session ended. */
  sweepAbandoned(): number {
    const now = this.now()
    const sinceLastSweep = now - this.lastSweepAt
    this.lastSweepAt = now
    // Why: after the machine sleeps, hooks have been frozen too; their silence is not absence.
    if (sinceLastSweep > this.abandonAfterMs) {
      for (const draft of this.pending()) {
        this.lastSeen.set(draft.id, now)
      }
      return 0
    }
    const cutoff = now - this.abandonAfterMs
    let dropped = 0
    for (const draft of this.pending()) {
      if ((this.lastSeen.get(draft.id) ?? this.startedAt) < cutoff) {
        this.deps.db().abandonDraft(draft.id)
        this.abandoned.add(draft.id)
        this.lastSeen.delete(draft.id)
        this.release(draft.id)
        dropped += 1
      }
    }
    if (dropped > 0) {
      this.deps.onChanged?.()
    }
    return dropped
  }

  private replyFor(draft: PulseDraft): GateReply {
    const call = draft.call
    if (!call) {
      return { state: 'final', output: preToolUse('deny', UNKNOWN_REASON) }
    }
    switch (draft.status) {
      case 'pending':
        return { state: 'pending', id: draft.id }
      case 'approved':
      case 'sent': {
        const release = this.releases.get(draft.id)
        if (draft.status === 'approved') {
          // Why: "sent" here means released to the agent; the tool call itself runs in the agent.
          this.deps.db().markDraftDelivery(draft.id, 'sent')
          this.lastSeen.delete(draft.id)
          this.releases.delete(draft.id)
        }
        const input = approvedToolInput(draft, call, release)
        // Why: a footer alone is not the owner's edit; the agent should not hunt for one.
        const edited = call.editField !== null && call.toolInput[call.editField] !== draft.body
        return {
          state: 'final',
          output: preToolUse(
            'allow',
            edited
              ? 'The user approved this action with edits in the Orca+ bell.'
              : 'The user approved this action in the Orca+ bell.',
            input ?? undefined,
            outgoingWaitingFollowUp(call, draft.target)
          )
        }
      }
      case 'rejected':
      case 'failed':
        return {
          state: 'final',
          output: preToolUse(
            'deny',
            this.releases.get(draft.id)?.denyReason ??
              (this.abandoned.has(draft.id) ? ABANDONED_REASON : REJECTED_REASON)
          )
        }
    }
  }

  private waitForChange(id: string): Promise<void> {
    return new Promise((resolve) => {
      const set = this.waiters.get(id) ?? new Set()
      this.waiters.set(id, set)
      const done = (): void => {
        clearTimeout(timer)
        set.delete(done)
        if (set.size === 0) {
          this.waiters.delete(id)
        }
        resolve()
      }
      const timer = setTimeout(done, this.holdMs)
      set.add(done)
    })
  }

  private release(id: string): void {
    // Why: each waiter deletes only itself, which a Set iteration tolerates.
    for (const done of this.waiters.get(id) ?? []) {
      done()
    }
    this.deps.onChanged?.()
  }
}
