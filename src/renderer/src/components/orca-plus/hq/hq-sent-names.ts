// Custom build (hq-sent-history): how the history names an approved call's destination, chat and
// thread — from its kept context, or read back out of an older approval card's first line.
import type { OutgoingSentContext } from '../../../../../shared/outgoing-approval/outgoing-sent-context'

export type HqSentNames = { target: string | null; chat: string | null; replyingTo: string | null }

/** Names from the context, or read back out of an older approval card's first line. */
export function hqSentNames(sent: OutgoingSentContext): HqSentNames {
  const head = sent.head ?? ''
  return {
    target: sent.targetName ?? /→ (.+?)(?: · |$)/.exec(head)?.[1] ?? sent.targetId,
    chat: sent.chatName ?? /from «(.+?)»/.exec(head)?.[1] ?? null,
    replyingTo: sent.replyingTo ?? /replying to (.+?)(?: · from |$)/.exec(head)?.[1] ?? null
  }
}
