// Custom build (hq-reply-approve): what the owner's buttons on an answer do — pass it to the chat
// that waits, or skip it. Either way the answer counts as handled and leaves the bell.
import type { HqWaitingReplyPassResult } from '../../shared/hq-waiting-reply-bell'
import { hqWaitingReplyPrompt } from '../../shared/hq-waiting-replies'
import type { PulseWaiting } from '../../shared/pulse-types'

export type HqWaitingReplyPassDeps = {
  listOpen: () => PulseWaiting[]
  /** True once the native chat took the turn, sent or queued. */
  deliver: (waiting: PulseWaiting, prompt: string) => Promise<boolean>
  markDelivered: (id: string, replyTs: string | undefined) => void
}

/** `replyTs`: the answer the owner was shown; a newer one waits for its own card. */
function pending(
  deps: HqWaitingReplyPassDeps,
  waitingId: string,
  replyTs: string | undefined
): PulseWaiting | null {
  const waiting = deps.listOpen().find((entry) => entry.id === waitingId)
  return waiting?.repliedAt &&
    waiting.replyDeliveredAt === null &&
    (replyTs === undefined || waiting.replyTs === replyTs)
    ? waiting
    : null
}

// Why: Pass in the card and in the bell at once must not send the answer twice.
const passing = new Set<string>()

/** `chat-closed`: the chat has no live session now; the caller reopens it and tries again. */
export async function passHqWaitingReply(
  deps: HqWaitingReplyPassDeps,
  waitingId: string,
  replyTs?: string,
  // Custom build (hq-plus-person-replies): the routing rule frames the answer as passed by rule.
  prompt: (waiting: PulseWaiting) => string = hqWaitingReplyPrompt
): Promise<HqWaitingReplyPassResult> {
  const waiting = passing.has(waitingId) ? null : pending(deps, waitingId, replyTs)
  if (!waiting) {
    return { ok: false, reason: 'gone' }
  }
  if (!waiting.agentSessionId) {
    return { ok: false, reason: 'no-chat' }
  }
  passing.add(waitingId)
  try {
    if (!(await deps.deliver(waiting, prompt(waiting)))) {
      return { ok: false, reason: 'chat-closed' }
    }
    deps.markDelivered(waiting.id, waiting.replyTs ?? undefined)
    return { ok: true }
  } finally {
    passing.delete(waitingId)
  }
}

export function skipHqWaitingReply(
  deps: HqWaitingReplyPassDeps,
  waitingId: string,
  replyTs?: string
): void {
  if (pending(deps, waitingId, replyTs)) {
    deps.markDelivered(waitingId, replyTs)
  }
}
