// Custom build (hq-ledger-feed): what a folded conversation card says — the ledger's messages with the
// owner's question kept in view, else the conversation told from its folded cards.
import type { HqFeedMessage } from './hq-feed-ledger'
import type { HqPlusLogItem } from './hq-plus-log'
import { HQ_INTAKE_KIND, readHqIntake } from './hq-slack-intake'
import { HQ_WAITING_REPLY_KIND, readHqWaitingReplyRef } from './hq-waiting-reply-bell'

/** The conversation told from its cards, when the ledger has no messages of it. */
export function messagesOfParts(members: readonly HqPlusLogItem[]): HqFeedMessage[] {
  const said: HqFeedMessage[] = []
  for (const item of members) {
    if (item.kind !== 'card' || !item.inbox) {
      continue
    }
    const answer =
      item.inbox.kind === HQ_WAITING_REPLY_KIND ? readHqWaitingReplyRef(item.inbox.refId) : null
    if (answer) {
      said.push({
        direction: 'out',
        author: null,
        text: answer.asked || answer.question,
        link: null,
        at: answer.askedAt
      })
      said.push({
        direction: 'in',
        author: answer.author,
        text: answer.reply,
        link: answer.link,
        at: item.at
      })
    }
    const intake = item.inbox.kind === HQ_INTAKE_KIND ? readHqIntake(item.inbox.refId) : null
    if (intake) {
      said.push({
        direction: 'in',
        author: intake.author,
        text: intake.text,
        link: intake.permalink,
        at: intake.lastAt ?? intake.at
      })
    }
  }
  const seen = new Set<string>()
  return said
    .filter((message) => {
      const key = `${message.direction}:${message.text}`
      return seen.has(key) ? false : (seen.add(key), true)
    })
    .sort((a, b) => a.at - b.at)
}

/** Keeps the owner's question in view: the ledger saw the answer, not always what was asked. */
export function withAsked(
  messages: readonly HqFeedMessage[],
  members: readonly HqPlusLogItem[]
): HqFeedMessage[] {
  if (messages.some((message) => message.direction === 'out')) {
    return [...messages]
  }
  const asked = messagesOfParts(members).find((message) => message.direction === 'out')
  return asked ? [asked, ...messages] : [...messages]
}
