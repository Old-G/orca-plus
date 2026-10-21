// Custom build (pulse-bell): the bell's inbox as the renderer sees it.
import type { PulseBellInput } from '../../shared/pulse-bell'
import type { PulseInboxItem } from '../../shared/pulse-types'
import type { HqWaitingReplyPassResult } from '../../shared/hq-waiting-reply-bell'

export type PulseBellApi = {
  list: () => Promise<PulseInboxItem[]>
  markRead: (ids: string[]) => Promise<void>
  markDone: (id: string, action?: string) => Promise<void>
  /** Only for the kinds the renderer owns (RENDERER_SYNCED_PULSE_BELL_KINDS). */
  syncKind: (kind: string, items: PulseBellInput[]) => Promise<void>
  onChanged: (callback: () => void) => () => void
  /** Custom build (hq-reply-approve): hands a person's answer to the chat that waits for it. */
  passWaitingReply: (waitingId: string) => Promise<HqWaitingReplyPassResult>
  skipWaitingReply: (waitingId: string) => Promise<void>
}
