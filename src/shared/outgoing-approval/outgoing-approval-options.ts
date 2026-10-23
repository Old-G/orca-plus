// Custom build (outgoing-footer, outgoing-venue): what an approval card offers beside Approve — the
// footer it adds, another place to send the message, a thread to continue — and what the owner chose.
import type { OutgoingMove, OutgoingThreadChoice } from './outgoing-venue'

export type OutgoingApprovalOptions = {
  /** The line Approve adds to the message; null for a call that takes none. */
  footer: string | null
  /** Where else the message could go: the task instead of Slack, or Slack instead of the task. */
  move: OutgoingMove | null
  /** Threads this chat already has in the channel a new Slack message goes to. */
  threads: OutgoingThreadChoice[]
}

export const NO_OUTGOING_APPROVAL_OPTIONS: OutgoingApprovalOptions = {
  footer: null,
  move: null,
  threads: []
}

export type OutgoingApprovalChoice = {
  /** False sends the message without its footer. */
  footer?: boolean
  /** Send the text there instead; the held call itself is not run. */
  moveTo?: 'clickup' | 'slack'
  /** The Slack thread the message goes into. */
  threadTs?: string
  /** Custom build (hq-plus-ui): with a rejection, what the owner tells the agent to change. */
  note?: string
}

const NOTE_MAX = 1000

const SLACK_TS = /^\d{9,11}\.\d{1,6}$/

export function readOutgoingApprovalChoice(value: unknown): OutgoingApprovalChoice {
  const read = (key: string): unknown =>
    value && typeof value === 'object' ? Reflect.get(value, key) : undefined
  const footer = read('footer')
  const moveTo = read('moveTo')
  const threadTs = read('threadTs')
  const note = read('note')
  return {
    ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, NOTE_MAX) } : {}),
    ...(typeof footer === 'boolean' ? { footer } : {}),
    ...(moveTo === 'clickup' || moveTo === 'slack' ? { moveTo } : {}),
    ...(typeof threadTs === 'string' && SLACK_TS.test(threadTs) ? { threadTs } : {})
  }
}
