// Custom build (hq-reply-approve): what the owner's buttons on an answer do — pass it to the chat
// that waits, or skip it. Either way the answer counts as handled and leaves the bell.
import type { HqWaitingReplyPassResult } from '../../shared/hq-waiting-reply-bell'
import { hqWaitingReplyPrompt } from '../../shared/hq-waiting-replies'
import type { PulseWaiting } from '../../shared/pulse-types'

export type HqWaitingReplyPassDeps = {
  listOpen: () => PulseWaiting[]
  /** True once the native chat took the turn, sent or queued. */
  deliver: (waiting: PulseWaiting, prompt: string) => Promise<boolean>
  markDelivered: (id: string) => void
}

function pending(deps: HqWaitingReplyPassDeps, waitingId: string): PulseWaiting | null {
  const waiting = deps.listOpen().find((entry) => entry.id === waitingId)
  return waiting?.repliedAt && waiting.replyDeliveredAt === null ? waiting : null
}

/** `chat-closed`: the chat has no live session now; the caller reopens it and tries again. */
export async function passHqWaitingReply(
  deps: HqWaitingReplyPassDeps,
  waitingId: string
): Promise<HqWaitingReplyPassResult> {
  const waiting = pending(deps, waitingId)
  if (!waiting) {
    return { ok: false, reason: 'gone' }
  }
  if (!waiting.agentSessionId) {
    return { ok: false, reason: 'no-chat' }
  }
  if (!(await deps.deliver(waiting, hqWaitingReplyPrompt(waiting)))) {
    return { ok: false, reason: 'chat-closed' }
  }
  deps.markDelivered(waiting.id)
  return { ok: true }
}

export function skipHqWaitingReply(deps: HqWaitingReplyPassDeps, waitingId: string): void {
  if (pending(deps, waitingId)) {
    deps.markDelivered(waitingId)
  }
}
