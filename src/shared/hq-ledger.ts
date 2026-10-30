// Custom build (hq-request-ledger): the place a message lives in — one Slack thread, one ClickUp task,
// one MR, one mail thread — as the key of its conversation. A reply finds what it answers by this
// key first, never by its words.
import { parseSlackThreadRef } from './hq-waiting-replies'

export type HqLedgerSource = 'slack' | 'clickup' | 'gitlab' | 'gmail'

export const HQ_CONVERSATION_STATES = ['you', 'wait', 'fyi', 'done'] as const
export type HqConversationState = (typeof HQ_CONVERSATION_STATES)[number]

/** How a message reached its conversation, best first; `which` asks the owner. */
export type HqLedgerStep = 'place' | 'person' | 'which' | 'new' | 'owner'

/** One message any reader saw. */
export type HqLedgerSignal = {
  /** Conversation key, from `hqPlaceKey`. */
  key: string
  ts: string
  at: number
  author: string | null
  authorId: string | null
  /** Written by the owner himself. */
  fromOwner: boolean
  text: string
  link: string | null
  /** Which reader saw it, e.g. `slack-mention`, `slack-reply`. */
  reader: string
  /** Addressed to the owner (a DM, a mention) — a new conversation of it waits on him. */
  forOwner: boolean
  /** A project the reader already knows (a rule, a named slug); null leaves it to the guess. */
  project: string | null
  title: string
}

export type HqLedgerResult = {
  conversationId: string
  step: HqLedgerStep
  /** False when the same message was already in the conversation. */
  added: boolean
  /** Waitings this message settles or may answer. */
  waitingIds: string[]
}

const GITLAB_MR = /gitlab\.com\/([\w.-]+(?:\/[\w.-]+)+?)\/-\/merge_requests\/(\d+)/

/** The conversation key of a waiting's `source_ref` or a message link; null when it names no place. */
export function hqPlaceKey(ref: string | null | undefined): string | null {
  if (!ref) {
    return null
  }
  const slack = parseSlackThreadRef(ref)
  if (slack) {
    return `slack:${slack.channel}:${slack.threadTs}`
  }
  const clickup = /^clickup:([^:\s]+)/.exec(ref.trim())
  if (clickup) {
    return `clickup:${clickup[1]}`
  }
  const task = /app\.clickup\.com\/t\/(?:\d+\/)?([\w-]+)/.exec(ref)
  if (task) {
    return `clickup:${task[1]}`
  }
  const mr = GITLAB_MR.exec(ref)
  if (mr) {
    return `gitlab:${mr[1]}!${mr[2]}`
  }
  const gitlab = /^gitlab:(.+![0-9]+)$/.exec(ref.trim())
  if (gitlab) {
    return `gitlab:${gitlab[1]}`
  }
  const gmail = /^gmail:(.+)$/.exec(ref.trim())
  return gmail ? `gmail:${gmail[1]}` : null
}
