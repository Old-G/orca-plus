// Custom build (hq-reply-approve): the owner's buttons on a person's answer — pass it to the chat
// that waits (bringing a closed chat back first), open that chat, or skip the answer.
import { toast } from 'sonner'
import {
  HQ_WAITING_REPLY_ACTION,
  type HqWaitingReplyRef
} from '../../../../../shared/hq-waiting-reply-bell'
import { translate } from '@/i18n/i18n'
import { openHqRouteChat, sendWithReopen } from './hq-route-send'

function chatRef(ref: HqWaitingReplyRef) {
  return ref.worktreeId && ref.sessionId
    ? { worktreeId: ref.worktreeId, sessionId: ref.sessionId }
    : null
}

export async function openHqWaitingReplyChat(ref: HqWaitingReplyRef): Promise<void> {
  const chat = chatRef(ref)
  if (chat) {
    await openHqRouteChat(chat)
  }
}

/** True once the chat took the answer. */
export async function passHqWaitingReply(ref: HqWaitingReplyRef): Promise<boolean> {
  const result = await sendWithReopen(chatRef(ref), () =>
    window.api.pulseBell.passWaitingReply(ref.waitingId, ref.replyTs)
  )
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
    await window.api.pulseBell.skipWaitingReply(ref.waitingId, ref.replyTs)
  }
}
