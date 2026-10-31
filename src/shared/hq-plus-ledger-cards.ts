// Custom build (hq-ledger-sources): HQ+'s card for a request-ledger conversation no other card stands
// for — a GitLab MR from the owner's To-Do list or a mail thread from a person. Open while it is his
// move (however old) or news since the day began; its buttons open the place or say Done.
import { hqPlusTranscript, type HqFeedConversation, type HqFeedLedger } from './hq-feed-ledger'
import { HQ_PLUS_ANY_ROOM, type HqPlusCard, type HqPlusLogItem } from './hq-plus-log'

/** The places whose talks have no cards of their own yet, so the ledger's conversation is the card.
 *  Slack and ClickUp keep their cards until the switch (19.6). */
const LEDGER_ONLY_PLACE = /^(?:gitlab|gmail):/

/** A card that stands for a ledger conversation alone: it has the Open and Done buttons. */
export function hqPlusLedgerOnly(item: HqPlusLogItem): boolean {
  return item.kind === 'card' && item.type === 'conversation' && !!item.conversation?.ledgerState
}

function ledgerOnlyCard(conversation: HqFeedConversation, state: 'you' | 'fyi'): HqPlusCard {
  const messages = conversation.messages
  return {
    kind: 'card',
    id: `conv:${conversation.key}`,
    at: Math.max(conversation.lastAt, messages.at(-1)?.at ?? 0),
    // Why: HQ's rooms place it by its project, as they place a bell item.
    room: HQ_PLUS_ANY_ROOM,
    project: conversation.project,
    address: null,
    sessionId: conversation.sessionId,
    type: 'conversation',
    title: conversation.title,
    body: hqPlusTranscript(messages),
    report: null,
    open: true,
    done: null,
    entry: null,
    inbox: null,
    conversation: {
      key: conversation.key,
      title: conversation.title,
      guessed: conversation.projectHow === 'model',
      messages: [...messages],
      parts: [],
      link: messages.toReversed().find((message) => message.link)?.link ?? null,
      ledgerState: state
    }
  }
}

/** The cards of the MRs and mail threads that have no rows in the feed (`folded` holds the places
 *  that do): the owner's move however old, news since `since`. */
export function hqPlusLedgerOnlyCards(
  ledger: HqFeedLedger,
  folded: ReadonlyMap<string, unknown>,
  since: number
): HqPlusCard[] {
  return ledger.conversations.flatMap((conversation) => {
    const state = conversation.state
    const shown =
      LEDGER_ONLY_PLACE.test(conversation.key) &&
      !folded.has(conversation.key) &&
      (state === 'you' || (state === 'fyi' && conversation.lastAt >= since))
    return shown ? [ledgerOnlyCard(conversation, state === 'you' ? 'you' : 'fyi')] : []
  })
}
