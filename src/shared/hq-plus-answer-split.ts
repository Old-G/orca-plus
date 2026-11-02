// Custom build (hq-plus-answer-cards, owner 02.11: «answers to different questions are glued into one
// card; I can't tell what goes where»): a person's answer to one of our questions is a card of its own
// — the question, the answer, the chat that asked — and the conversation card keeps only what answers
// none of them. Variant «Proposed» of the HQ+ answer cards mockup.
import type { HqFeedMessage } from './hq-feed-ledger'
import type { HqPlusLogItem } from './hq-plus-log'
import {
  HQ_WAITING_REPLY_KIND,
  readHqWaitingReplyRef,
  type HqWaitingReplyRef
} from './hq-waiting-reply-bell'

/** A waiting's answer card, open or already sent to its chat: it stands apart from its conversation. */
export function hqPlusAnswerOf(item: HqPlusLogItem): HqWaitingReplyRef | null {
  return item.kind === 'card' && item.inbox?.kind === HQ_WAITING_REPLY_KIND
    ? readHqWaitingReplyRef(item.inbox.refId)
    : null
}

const plain = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Whether a conversation's message is one an answer card already shows: the person's words it took,
 *  or the owner's question it answers. */
function shownByAnswer(message: HqFeedMessage, answer: HqWaitingReplyRef): boolean {
  const said = plain(message.text)
  if (!said) {
    return false
  }
  if (message.direction === 'in') {
    return (
      (answer.link !== null && message.link === answer.link) || plain(answer.reply).includes(said)
    )
  }
  const asked = plain(answer.asked ?? '')
  return asked.length > 0 && (asked === said || asked.includes(said) || said.includes(asked))
}

/** The conversation's messages less those its answer cards show. */
export function hqPlusMessagesLeft(
  messages: readonly HqFeedMessage[],
  answers: readonly HqWaitingReplyRef[]
): HqFeedMessage[] {
  return messages.filter((message) => !answers.some((answer) => shownByAnswer(message, answer)))
}
