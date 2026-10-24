// Custom build (chat-auto-effort): the picked effort is also saved as the chat's own, so the
// composer's effort shows what the last message went with instead of a choice made long ago.
import { pickAgentSessionOption } from '../../runtime/agent-session-record-options'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'

type Store = Pick<AgentSessionRecordStore, 'getRecord' | 'reviseSessionOptions'>

/** Bookkeeping after the pick: a refused or failed write keeps the chat's effort and never the send. */
export async function saveAutoEffortPick(
  store: Store,
  sessionId: string,
  picked: Readonly<Record<string, string>> | undefined,
  warn: (message: string, details: { scope: string; sessionId: string; error: unknown }) => void,
  now: () => number = Date.now
): Promise<void> {
  const effort = picked?.effort
  const record = store.getRecord(sessionId)
  if (!effort || !record || record.options?.effort === effort) {
    return
  }
  await store
    .reviseSessionOptions(pickAgentSessionOption, {
      sessionId,
      fence: record.lease.runtimeFence,
      key: 'effort',
      value: effort,
      models: undefined,
      now: now()
    })
    .then(
      () => undefined,
      (error: unknown) =>
        warn('saving the picked effort as the chat effort failed', {
          scope: 'chat-auto-effort',
          sessionId,
          error
        })
    )
}
