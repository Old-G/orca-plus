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
  /** `replyTs`: the answer the owner was shown; a newer one is not passed or skipped with it. */
  passWaitingReply: (waitingId: string, replyTs?: string) => Promise<HqWaitingReplyPassResult>
  skipWaitingReply: (waitingId: string, replyTs?: string) => Promise<void>
  /** Custom build (hq-slack-intake): a prompt into a native chat; `chat-closed` when it has no live session. */
  sendToChat: (sessionId: string, prompt: string) => Promise<HqWaitingReplyPassResult>
  /** Custom build (hq-intake-thread): a Slack thread whole for «To work» — its lines and links; null
   *  when Slack could not be read. */
  intakeThread: (
    channel: string,
    threadTs: string
  ) => Promise<{ lines: string[]; links: string[] } | null>
  /** Later on a «To work» card: a Notes line with the whole source. */
  keepIntakeInNotes: (
    itemId: string,
    project: string | null,
    note: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  closeIntake: (
    itemId: string,
    action: 'sent' | 'skipped',
    resolution: string,
    /** Custom build (hq-request-ledger): the chat that took it, so its thread stays with that chat. */
    sessionId?: string | null
  ) => Promise<void>
}
