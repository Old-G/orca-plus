// Custom build (hq-reply-approve): the owner's buttons on a person's answer — pass it to the chat
// that waits (bringing a closed chat back first), open that chat, or skip the answer.
import { toast } from 'sonner'
import {
  HQ_WAITING_REPLY_ACTION,
  type HqWaitingReplyPassResult,
  type HqWaitingReplyRef
} from '../../../../../shared/hq-waiting-reply-bell'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import { useAppStore } from '@/store'
import { startHqChatWithPrompt } from '../hq/hq-ask-chat'
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

/** The worktree a chat's tab is in, when the store knows it. */
function worktreeOfSession(sessionId: string): string | null {
  const tabId = structuredAgentSessionTabId(sessionId)
  const tabs = useAppStore.getState().unifiedTabsByWorktree
  return Object.keys(tabs).find((id) => tabs[id]?.some((tab) => tab.id === tabId)) ?? null
}

/** Custom build (hq-request-ledger, 19.7): the chain's live end is closed — the owner picks between
 *  reopening it and a new chat of the project that gets the answer with its question. */
function offerClosedChat(ref: HqWaitingReplyRef, liveSessionId: string, prompt: string): void {
  const worktreeId = worktreeOfSession(liveSessionId) ?? ref.worktreeId
  if (!worktreeId) {
    return
  }
  toast(
    translate('auto.hqWaitingReply.closed', 'The chat that waits for {{name}} is closed', {
      name: ref.author
    }),
    {
      description: translate(
        'auto.hqWaitingReply.closedHint',
        'Reopen it with the answer, or start a new chat of the project with it'
      ),
      duration: 30_000,
      action: {
        label: translate('auto.hqWaitingReply.reopen', 'Reopen'),
        onClick: () =>
          void sendWithReopen({ worktreeId, sessionId: liveSessionId }, () =>
            window.api.pulseBell.passWaitingReply(ref.waitingId, ref.replyTs)
          ).then((result) => reportPassed(ref, result))
      },
      cancel: {
        label: translate('auto.hqWaitingReply.newChat', 'New chat'),
        onClick: () =>
          void startHqChatWithPrompt(worktreeId, prompt, `${ref.author}: answer`).then(
            async (started) => {
              if (!started.ok) {
                toast.error(started.message)
                return
              }
              // Why: the new chat has the answer; the card is handled, as after a pass.
              await window.api.pulseBell.skipWaitingReply(ref.waitingId, ref.replyTs)
              toast.success(
                translate('auto.hqWaitingReply.newChatStarted', 'A new chat took the answer')
              )
            }
          )
      }
    }
  )
}

function reportPassed(ref: HqWaitingReplyRef, result: HqWaitingReplyPassResult): boolean {
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

/** True once the chat took the answer. */
export async function passHqWaitingReply(ref: HqWaitingReplyRef): Promise<boolean> {
  const first = await window.api.pulseBell.passWaitingReply(ref.waitingId, ref.replyTs)
  if (!first.ok && first.reason === 'chat-closed' && first.liveSessionId && first.prompt) {
    offerClosedChat(ref, first.liveSessionId, first.prompt)
    return false
  }
  // Why: a closed chat the Mac names no live end of is brought back as before.
  const result =
    !first.ok && first.reason === 'chat-closed'
      ? await sendWithReopen(chatRef(ref), () =>
          window.api.pulseBell.passWaitingReply(ref.waitingId, ref.replyTs)
        )
      : first
  return reportPassed(ref, result)
}

/** False when Pass or Close did not go through (HQ+ brings back a card it closed on the click). */
export async function runHqWaitingReplyAction(
  ref: HqWaitingReplyRef,
  actionId: string
): Promise<boolean> {
  if (actionId === HQ_WAITING_REPLY_ACTION.deliver) {
    return passHqWaitingReply(ref)
  } else if (actionId === HQ_WAITING_REPLY_ACTION.open) {
    await openHqWaitingReplyChat(ref)
  } else if (actionId === HQ_WAITING_REPLY_ACTION.skip) {
    await window.api.pulseBell.skipWaitingReply(ref.waitingId, ref.replyTs)
  } else if (actionId === HQ_WAITING_REPLY_ACTION.close) {
    // Custom build (hq-plus-cards): the answer is enough — the waiting closes, the chat is not told.
    const closed = await window.api.runtime.call({
      method: 'pulse.closeWaiting',
      params: { id: ref.waitingId, status: 'resolved', resolution: `HQ+: ${ref.author}` }
    })
    if (!closed.ok) {
      toast.error(translate('auto.hqWaitingReply.closeFailed', 'The waiting could not be closed'))
      return false
    }
    await window.api.pulseBell.skipWaitingReply(ref.waitingId, ref.replyTs)
  }
  return true
}
