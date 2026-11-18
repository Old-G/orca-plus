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
  /** True while a person's comment newer than the owner's side's last message is there. */
  owesMore: (key: string) => boolean
  close: (key: string) => boolean
  now: () => number
}

/** Records the send and closes the conversation unless a comment newer than the sent ones is there. */
export function hqRecordSentToChat(
  deps: HqSentToChatDeps,
  key: string,
  sentTo: HqSentToChat
): { closed: boolean } {
  // Why at the newest comment sent, not now and not past it: the batch holds every comment up to
  // that time, and one a millisecond later was not sent, so the line must not pass over it.
  const at = Math.min(deps.now(), sentTo.upTo)
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
  if (deps.owesMore(key)) {
    return { closed: false }
  }
  return { closed: deps.close(key) }
}
