// Custom build (hq-one-card): Slack messages another card already shows — the thread a chat's question
// was asked in, the answer it got, a message the mention / 👾 intake raised — so the scout's card for
// the same message is not a second one.
import { readHqIntake } from './hq-slack-intake'
import { parseSlackThreadRef } from './hq-waiting-replies'
import type { PulseInboxItem, PulseWaiting } from './pulse-types'

/** `channel:ts` of a Slack permalink, and of its thread when it is a reply. */
function permalinkKeys(link: string | null | undefined): string[] {
  const match = link ? /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(link) : null
  if (!match) {
    return []
  }
  const thread = /[?&]thread_ts=(\d+\.\d+)/.exec(link ?? '')?.[1]
  return [`${match[1]}:${match[2]}.${match[3]}`, ...(thread ? [`${match[1]}:${thread}`] : [])]
}

export function hqCoveredSlackMessages(
  waitings: readonly PulseWaiting[],
  intake: readonly PulseInboxItem[],
  since: number
): Set<string> {
  const keys = new Set<string>()
  for (const waiting of waitings) {
    const live = waiting.status === 'open' || (waiting.resolvedAt ?? 0) >= since
    if (waiting.direction !== 'on-them' || waiting.repliedAt === null || !live) {
      continue
    }
    const thread = parseSlackThreadRef(waiting.sourceRef)
    if (thread) {
      keys.add(`${thread.channel}:${thread.threadTs}`)
    }
    for (const key of permalinkKeys(waiting.replyLink)) {
      keys.add(key)
    }
  }
  for (const item of intake) {
    const raised = item.createdAt >= since ? readHqIntake(item.refId) : null
    if (raised) {
      keys.add(`${raised.channel}:${raised.ts}`)
      if (raised.threadTs) {
        keys.add(`${raised.channel}:${raised.threadTs}`)
      }
    }
  }
  return keys
}
