// Custom build (hq-waiting-replies): hands a person's answer to the native chat that waits for it,
// through the composer's own send (queued while a turn runs). Never typed into a terminal: once its
// agent exits, the pane is a shell and someone else's words would run as commands.
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import type { PulseWaiting } from '../../../shared/pulse-types'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/structured-agent-session-registry'
import { sendAgentTurn } from '../../runtime/orchestration/send-agent-turn'
import { mintAgentSessionOperationId } from '../../runtime/orchestration/structured-pointer-operation-id'

/** `operationId` is the send's idempotency key: reuse it on a retry of the same message. */
export async function deliverToNativeChat(
  sessionId: string,
  prompt: string,
  sender = 'hq-waiting-replies',
  operationId = mintAgentSessionOperationId(Date.now())
): Promise<boolean> {
  const host = getStructuredAgentSessionHost()
  const fence = host?.deps.store.getRecord(sessionId)?.lease.runtimeFence
  // Why: a chat with no live lease cannot take input; the relay tries again once it is open.
  if (!host || !fence) {
    return false
  }
  const body: AgentJournalMessageItem = {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: prompt }]
  }
  const outcome = await sendAgentTurn({
    kind: 'structured-session',
    host,
    sessionId,
    callerKey: `trusted-local:${sender}:${sessionId}`,
    turn: {
      body,
      operationId,
      expectedRuntimeFence: fence,
      delivery: 'queue'
    }
  })
  return outcome.kind !== 'refused'
}

export async function deliverWaitingReply(waiting: PulseWaiting, prompt: string): Promise<boolean> {
  return waiting.agentSessionId ? deliverToNativeChat(waiting.agentSessionId, prompt) : false
}
