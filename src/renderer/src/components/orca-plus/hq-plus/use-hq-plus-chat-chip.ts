// Custom build (hq-plus-chats-by-project, hq-plus-work-view): what a chat is doing, as one coloured chip —
// the same in the Chats column and the Work view; none once read.
import { translate } from '@/i18n/i18n'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqPlusChatIsIdle, hqPlusChatWaitingLabel } from './hq-plus-chats'
import { useHqPlusLastReply } from './use-hq-plus-last-reply'

export type HqPlusChatChip = { label: string; tone: string }

function chipOf(item: HqChatItem, now: number): HqPlusChatChip | null {
  switch (item.group) {
    case 'needs':
      return { label: translate('auto.hqPlus.side.waiting', 'waits on you'), tone: 'move' }
    case 'working':
      return { label: translate('auto.hqPlus.side.working', 'working'), tone: 'working' }
    case 'done':
      return { label: translate('auto.hqPlus.side.done', 'done'), tone: 'done' }
    case 'quiet':
      // Why: a chat opened a moment ago has no turn yet; it is starting, not idle.
      return hqPlusChatIsIdle(item, now)
        ? null
        : { label: translate('auto.hqPlus.side.starting', 'starting'), tone: 'working' }
  }
}

export function useHqPlusChatChip(
  item: HqChatItem,
  now: number,
  /** Read the whole latest reply even while the chat works or asks (the Work view's «Last report»). */
  readAlways = false
): {
  chip: HqPlusChatChip | null
  /** What the chat waits for, from its last words; null when it does not say. */
  waitingFor: string | null
  /** A working or starting chat pulses. */
  live: boolean
  /** The agent's whole latest reply from the transcript; null until read. */
  reply: string | null
} {
  // Custom build (hq-plus-chat-waiting, owner 02.11): a chat whose last words ask to stay open until
  // someone answers says «waiting», so the owner keeps it and brings the answer back to it. Those words
  // close a reply, and the card's preview is its first 200 characters on one line, so the row reads the
  // whole reply from the chat's transcript.
  const settled = item.group !== 'needs' && item.group !== 'working'
  const sessionId =
    item.kind === 'chat' && item.tab.contentType === 'agent-session' ? item.tab.entityId : null
  const reply = useHqPlusLastReply(sessionId, settled || readAlways, item.sortAt)
  // Custom build (hq-plus-waiting-after-read): unread, it stays «done» until the owner opens it.
  const waitingFor = hqPlusChatWaitingLabel(item, reply ?? item.card?.lastAgentMessage)
  const chip = waitingFor
    ? { label: translate('auto.hqPlus.side.waitingFor', 'waiting'), tone: 'waits' }
    : chipOf(item, now)
  const live = item.group === 'working' || (item.group === 'quiet' && !hqPlusChatIsIdle(item, now))
  return { chip, waitingFor, live, reply }
}
