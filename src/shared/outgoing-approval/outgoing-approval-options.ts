// Custom build (outgoing-footer, outgoing-venue): what an approval card offers beside Approve — the
// footer it adds, another place to send the message, a thread to continue — and what the owner chose.
import type { OutgoingSourceMessage } from './outgoing-approval-bell'
import type { OutgoingMove, OutgoingThreadChoice } from './outgoing-venue'

/** Custom build (router v2 T1): a work the message can be bound to — the chain of chats an answer to
 *  it should reach — named by its chat now. */
export type OutgoingWorkChoice = {
  /** The work's id: its first chat's session id. */
  id: string
  /** The chat carrying it now. */
  title: string
  /** Why it is offered, in the card's words. */
  why: string
  /** The footer Approve adds with this work; null for a call that takes none. */
  footer: string | null
}

export type OutgoingWorkOptions = {
  /** The work Approve binds to unless the owner picks another: the sender's, or the router's guess. */
  current: string
  /** True when the sending chat has no work of its own and the router suggested `current`. */
  suggested: boolean
  choices: OutgoingWorkChoice[]
}

export type OutgoingApprovalOptions = {
  /** The line Approve adds to the message; null for a call that takes none. */
  footer: string | null
  /** Where else the message could go: the task instead of Slack, or Slack instead of the task. */
  move: OutgoingMove | null
  /** Threads this chat already has in the channel a new Slack message goes to. */
  threads: OutgoingThreadChoice[]
  /** Custom build (router v2 T1): the work the message binds to, and the others it may. */
  work?: OutgoingWorkOptions | null
  /** Custom build (hq-approve-source, U5): the message this one answers, for «What came in». */
  source?: OutgoingSourceMessage | null
}

export const NO_OUTGOING_APPROVAL_OPTIONS: OutgoingApprovalOptions = {
  footer: null,
  move: null,
  threads: [],
  work: null,
  source: null
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
  /** Custom build (router v2 T1): the work the owner bound the message to on the card. */
  workId?: string
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
  const workId = read('workId')
  return {
    ...(typeof workId === 'string' && /^[\w-]{8,80}$/.test(workId) ? { workId } : {}),
    ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, NOTE_MAX) } : {}),
    ...(typeof footer === 'boolean' ? { footer } : {}),
    ...(moveTo === 'clickup' || moveTo === 'slack' ? { moveTo } : {}),
    ...(typeof threadTs === 'string' && SLACK_TS.test(threadTs) ? { threadTs } : {})
  }
}
