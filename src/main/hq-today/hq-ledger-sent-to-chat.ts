// Custom build (hq-mr-comments, T14): «Send to chat» on an MR's card, on the main side — the comments
// still owed to the chat (all of them, not the card's short preview), and the record of a send that
// closes the card only when nothing came in after what was sent.
import type { HqLedgerResult, HqLedgerSignal } from '../../shared/hq-ledger'
import { HQ_SENT_TO_CHAT_READER } from '../../shared/hq-conversation-chat-prompt'

/** Why a cap: one prompt stays readable; what is past it stays on the card for the next send. */
export const HQ_SEND_TO_CHAT_MAX = 30

export type HqSentToChat = { sessionId: string; chat: string; upTo: number }

export type HqSentToChatDeps = {
  ingest: (signal: HqLedgerSignal) => HqLedgerResult
  lastDirection: (key: string) => 'in' | 'out' | null
  close: (key: string) => boolean
  now: () => number
}

/** Records the send and closes the conversation unless a comment newer than the sent ones is there. */
export function hqRecordSentToChat(
  deps: HqSentToChatDeps,
  key: string,
  sentTo: HqSentToChat
): { closed: boolean } {
  // Why just after the newest comment sent, not now: a comment GitLab shows on a later pass
  // with an older time lands after this line, brings the card back and goes with the next send.
  const at = Math.min(deps.now(), sentTo.upTo + 1)
  deps.ingest({
    key,
    ts: `sent:${String(at)}`,
    at,
    author: null,
    authorId: null,
    fromOwner: true,
    text: `Sent to chat «${sentTo.chat}»`,
    link: null,
    reader: HQ_SENT_TO_CHAT_READER,
    forOwner: false,
    project: null,
    title: 'Sent to chat',
    sessionId: sentTo.sessionId
  })
  // Why: a comment that came in while the send was on its way, or one past the cap, was not sent;
  // the card stays so it goes with the next send.
  if (deps.lastDirection(key) === 'in') {
    return { closed: false }
  }
  return { closed: deps.close(key) }
}
