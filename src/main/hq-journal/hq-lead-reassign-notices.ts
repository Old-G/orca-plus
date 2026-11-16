// Custom build (hq-lead-reassign, owner 16.11): what `orca hq reassign` tells the new Lead, the moved
// chats and the old Lead, and the journal rows that keep it on their threads.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  hqJournalTitle,
  type HqJournalInput,
  type HqSession
} from '../../shared/hq-journal'
import type { HqLeadReassignChat } from '../../shared/hq-chat-links'
import { hqLeadBatchPrompt, type HqLeadHeld } from './hq-lead-batch'

const SOURCE = 'lead-reassign'

/** A chat as the notices name it: its thread, else its session id. */
export function hqReassignRef(chat: HqLeadReassignChat): string {
  return chat.address ?? chat.sessionId
}

export type HqReassignNoticeInput = {
  from: HqLeadReassignChat
  to: HqLeadReassignChat
  moved: readonly HqLeadReassignChat[]
  /** Who ran the command: a chat's thread, or the owner. */
  by: string
  plans: readonly string[]
  /** Every open chat moved, not a part of the team. */
  whole: boolean
  held: HqLeadHeld | null
}

export function hqReassignNotices(input: HqReassignNoticeInput): {
  chat: string
  lead: string
  oldLead: string
} {
  const from = hqReassignRef(input.from)
  const to = hqReassignRef(input.to)
  const count = input.moved.length
  const list = input.moved
    .map((chat) => {
      const session = chat.address ? ` (${chat.sessionId})` : ''
      return `- ${hqReassignRef(chat)}${session}${chat.name ? ` — ${chat.name}` : ''}`
    })
    .join('\n')
  const planLine =
    input.plans.length > 0
      ? `The «Lead chat:» line now names you in ${input.plans.join(', ')}.`
      : input.whole
        ? `No plan file in HQ/runs names ${from}; if you keep one, write yourself into its «Lead chat:» line.`
        : 'The plan still names the old Lead; only these chats moved.'
  const held = input.held
    ? [
        '',
        'Held for the old Lead and handed to you with this:',
        '',
        hqLeadBatchPrompt(input.held.prompts, input.held.since)
      ]
    : []
  return {
    chat: [
      `Orca+ · your Lead changed (by ${input.by}): ${to} leads this chat now, not ${from}.`,
      `Reports (DONE / NEEDS DECISION / BLOCKED) go to it: orca chat send ${to} "…". A message sent to ${from} reaches the new Lead too.`
    ].join('\n'),
    lead: [
      `Orca+ · you lead ${count === 1 ? 'one more chat' : `${count} more chats`} now, taken over from ${from} (by ${input.by}):`,
      list,
      `Their reports come to this chat; what they send to ${from} reaches you too.`,
      planLine,
      ...held
    ].join('\n'),
    oldLead: [
      `Orca+ · ${count === 1 ? 'one of your chats reports' : `${count} of your chats report`} to the Lead ${to} now (by ${input.by}):`,
      list,
      `Send them no more work; what they send to you goes to ${to}.`
    ].join('\n')
  }
}

/** The notice as a done row on the chat's thread; none for a chat without a thread. */
export function hqReassignRow(
  session: HqSession | null,
  chat: HqLeadReassignChat,
  text: { title: string; body: string },
  at: number
): HqJournalInput | null {
  if (!chat.address) {
    return null
  }
  return {
    workspace: session?.workspace ?? HQ_JOURNAL_ALL_ROOMS,
    kind: HQ_JOURNAL_KIND.chatMessage,
    at,
    project: session?.project ?? chat.address.split('/')[0] ?? null,
    address: chat.address,
    sessionId: chat.sessionId,
    personId: null,
    title: hqJournalTitle(text.title),
    body: text.body,
    needs: `agent:${chat.address}`,
    status: 'done',
    replyTo: null,
    refKind: 'session',
    refId: chat.sessionId,
    source: SOURCE,
    dedupeKey: `${SOURCE}:${chat.address}:${at}`
  }
}
