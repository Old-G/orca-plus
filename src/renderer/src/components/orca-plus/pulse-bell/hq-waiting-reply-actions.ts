// Custom build (hq-reply-approve): the owner's buttons on a person's answer — pass it to the chat
// that waits (bringing a closed chat back first), open that chat, or skip the answer.
import { toast } from 'sonner'
import {
  HQ_WAITING_REPLY_ACTION,
  type HqWaitingReplyRef
} from '../../../../../shared/hq-waiting-reply-bell'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { translate } from '@/i18n/i18n'

// Why: a reopened chat takes a moment to attach its session before it can take a turn.
const REOPEN_TRIES = 15
const REOPEN_STEP_MS = 1_000

// Why lazy: reopening a chat pulls in the session-restore stack, which the bell needs only on a click.
async function openChat(chat: { worktreeId: string; sessionId: string; tabId: string }) {
  const { openHqHistoryEntry } = await import('../hq/hq-history-open')
  await openHqHistoryEntry(chat)
}

function chatRef(ref: HqWaitingReplyRef) {
  return ref.worktreeId && ref.sessionId
    ? {
        worktreeId: ref.worktreeId,
        sessionId: ref.sessionId,
        tabId: structuredAgentSessionTabId(ref.sessionId)
      }
    : null
}

export async function openHqWaitingReplyChat(ref: HqWaitingReplyRef): Promise<void> {
  const chat = chatRef(ref)
  if (chat) {
    await openChat(chat)
  }
}

/** True once the chat took the answer. */
export async function passHqWaitingReply(ref: HqWaitingReplyRef): Promise<boolean> {
  let result = await window.api.pulseBell.passWaitingReply(ref.waitingId)
  const chat = chatRef(ref)
  if (!result.ok && result.reason === 'chat-closed' && chat) {
    await openChat(chat)
    for (let tries = 0; tries < REOPEN_TRIES && !result.ok; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, REOPEN_STEP_MS))
      result = await window.api.pulseBell.passWaitingReply(ref.waitingId)
      if (!result.ok && result.reason !== 'chat-closed') {
        break
      }
    }
  }
  if (result.ok) {
    toast.success(
      translate('auto.hqWaitingReply.passed', '{{name}}’s answer went to the chat', {
        name: ref.author
      }),
      { description: ref.project ?? undefined }
    )
    return true
  }
  toast.error(
    result.reason === 'gone'
      ? translate('auto.hqWaitingReply.gone', 'This answer was already handled')
      : translate(
          'auto.hqWaitingReply.notTaken',
          'The chat could not take the answer — open it and press Pass to chat again'
        )
  )
  return false
}

export async function runHqWaitingReplyAction(
  ref: HqWaitingReplyRef,
  actionId: string
): Promise<void> {
  if (actionId === HQ_WAITING_REPLY_ACTION.deliver) {
    await passHqWaitingReply(ref)
  } else if (actionId === HQ_WAITING_REPLY_ACTION.open) {
    await openHqWaitingReplyChat(ref)
  } else if (actionId === HQ_WAITING_REPLY_ACTION.skip) {
    await window.api.pulseBell.skipWaitingReply(ref.waitingId)
  }
}
