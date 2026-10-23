// Custom build (hq-plus-journal): what Orca+ already keeps — waitings and the answers to them,
// Approve's drafts and decisions, finished agent turns — as journal rows. Each row's dedupe key
// names the thing and its step, so reading the same record again adds nothing.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  type HqJournalEntry,
  type HqJournalInput,
  type HqJournalLink,
  type HqJournalStatus,
  type HqSessionInput
} from '../../shared/hq-journal'
import { readHqFinishedChat, type HqHistorySource } from '../../shared/hq-chat-history'
import type { PulseDecision, PulseDraft, PulseWaiting } from '../../shared/pulse-types'
import { HQ_FEED_SESSION_SAID_MIN } from '../hq-today/hq-feed-work'
import type { HqPlace, HqRoomRef } from './hq-journal-rooms'

export type HqJournalPlacer = (ref: HqRoomRef) => HqPlace

/** A chat in the HQ repo writes HQ+'s own events, above the rooms. */
export function hqJournalRoom(place: HqPlace): string {
  return place.hq ? HQ_JOURNAL_ALL_ROOMS : place.room
}

export function hqJournalPlacement(place: HqPlace): 'firm' | 'fallback' {
  return place.firm ? 'firm' : 'fallback'
}

/** `slack` or `clickup` when a source or service names one; the rooms that use it claim the record. */
export function hqJournalChannel(value: string | null | undefined): 'slack' | 'clickup' | null {
  return /clickup/i.test(value ?? '') ? 'clickup' : /slack/i.test(value ?? '') ? 'slack' : null
}

export function hqJournalLink(url: string | null | undefined): HqJournalLink[] {
  const host = url && /^https:\/\/\S+$/.test(url) ? /^https:\/\/([^/?#]+)/.exec(url)?.[1] : null
  if (!url || !host) {
    return []
  }
  const channel = hqJournalChannel(host)
  const kind = channel ?? (/\/(?:merge_requests|pull)\/\d+/.test(url) ? 'mr' : 'url')
  return [{ kind, url: url.slice(0, 1000) }]
}

/** A written row as the input that writes it again — by its dedupe key, with `change` applied. */
export function journalEntryAsInput(
  entry: HqJournalEntry,
  change: Partial<HqJournalInput>
): HqJournalInput {
  return {
    workspace: entry.workspace,
    kind: entry.kind,
    project: entry.project,
    address: entry.address,
    sessionId: entry.sessionId,
    personId: entry.personId,
    title: entry.title,
    needs: entry.needs,
    replyTo: entry.replyTo,
    refKind: entry.refKind,
    refId: entry.refId,
    source: entry.source,
    dedupeKey: entry.dedupeKey,
    ...change
  }
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export type HqJournalPeople = (personId: string) => string | null

/** A waiting opened, closed, and the person's latest answer to it. */
export function waitingJournal(
  waiting: PulseWaiting,
  place: HqJournalPlacer,
  personName: HqJournalPeople,
  sessionAddress: (sessionId: string) => string | null
): HqJournalInput[] {
  const where = place({
    worktreeId: waiting.worktreeId,
    sessionId: waiting.agentSessionId,
    project: waiting.project,
    channel: hqJournalChannel(waiting.source)
  })
  const who = waiting.personId ? personName(waiting.personId) : null
  const base = {
    workspace: hqJournalRoom(where),
    placement: hqJournalPlacement(where),
    project: where.project,
    address: null,
    sessionId: waiting.agentSessionId,
    personId: waiting.personId,
    replyTo: null,
    refKind: 'waiting',
    refId: waiting.id
  }
  const closed: HqJournalStatus =
    waiting.status === 'open' ? 'open' : waiting.status === 'resolved' ? 'done' : 'dropped'
  const entries: HqJournalInput[] = [
    {
      ...base,
      kind: HQ_JOURNAL_KIND.waitingOpen,
      at: waiting.createdAt,
      title:
        waiting.direction === 'on-them'
          ? `Waiting on ${who ?? 'someone'}: ${waiting.title}`
          : `${who ?? 'Someone'} waits on the owner: ${waiting.title}`,
      body: waiting.detail,
      needs:
        waiting.direction === 'on-them'
          ? `person:${waiting.personId ?? 'unknown'}`
          : 'owner:decide',
      status: closed,
      links: hqJournalLink(waiting.sourceRef),
      source: `pulse-wait:${waiting.source}`,
      dedupeKey: `${HQ_JOURNAL_KIND.waitingOpen}:${waiting.id}`
    }
  ]
  if (waiting.status !== 'open' && waiting.resolvedAt !== null) {
    entries.push({
      ...base,
      kind: HQ_JOURNAL_KIND.waitingDone,
      at: waiting.resolvedAt,
      title: `${waiting.status === 'resolved' ? 'Resolved' : 'Cancelled'}: ${waiting.title}`,
      body: waiting.resolution,
      needs: 'nobody',
      status: 'done',
      source: `pulse-wait:${waiting.source}`,
      dedupeKey: `${HQ_JOURNAL_KIND.waitingDone}:${waiting.id}`
    })
  }
  if (waiting.reply && waiting.repliedAt !== null && waiting.replyTs) {
    const asking = waiting.agentSessionId
      ? (sessionAddress(waiting.agentSessionId) ?? waiting.agentSessionId)
      : null
    const viaClickUp = hqJournalChannel(waiting.replyLink) === 'clickup'
    entries.push({
      ...base,
      kind: HQ_JOURNAL_KIND.personReply,
      at: waiting.repliedAt,
      title: `${waiting.replyAuthor ?? who ?? 'Someone'}: ${oneLine(waiting.reply)}`,
      body: `${waiting.reply}\n\nAnswer to: ${waiting.title}`,
      needs: asking ? `agent:${asking}` : 'owner:decide',
      status: waiting.replyDeliveredAt !== null || waiting.status !== 'open' ? 'done' : 'open',
      links: hqJournalLink(waiting.replyLink),
      source: viaClickUp ? 'clickup-poller' : 'slack-reader',
      dedupeKey: `${HQ_JOURNAL_KIND.personReply}:${waiting.id}:${waiting.replyTs}`,
      // Why: the waiting keeps only the newest answer; an earlier one is no one's move any more.
      supersedes: true
    })
  }
  return entries
}

/** Something an agent wanted to send or run, held for the owner. `decision`: the owner's answer,
 *  whose record of where the call ran places it when its chat is long gone. */
export function draftJournal(
  draft: PulseDraft,
  place: HqJournalPlacer,
  decision: PulseDecision | null
): HqJournalInput {
  const call = draft.call
  const context = decision?.sentContext
  const where = place({
    worktreeId: context?.worktreeId,
    sessionId: call?.agentSessionId,
    cwd: call?.cwd,
    project: draft.project ?? context?.project,
    channel: hqJournalChannel(call?.service)
  })
  const status: HqJournalStatus =
    draft.status === 'pending' ? 'open' : draft.status === 'rejected' ? 'dropped' : 'done'
  return {
    workspace: hqJournalRoom(where),
    placement: hqJournalPlacement(where),
    kind: HQ_JOURNAL_KIND.approveRequest,
    at: draft.createdAt,
    project: where.project,
    address: null,
    sessionId: call?.agentSessionId ?? null,
    personId: draft.personId,
    title: `Approve: ${draft.title ?? `${draft.kind} → ${draft.target ?? 'no target'}`}`,
    body: draft.body,
    needs: 'owner:approve',
    status,
    replyTo: null,
    refKind: 'draft',
    refId: draft.id,
    source: 'approve-gate',
    dedupeKey: `${HQ_JOURNAL_KIND.approveRequest}:${draft.id}`
  }
}

const OUTCOME: Record<NonNullable<PulseDecision['outcome']>, string> = {
  approved: 'Approved',
  edited: 'Approved with edits',
  rejected: 'Rejected'
}

/** The owner's answer to a held draft; logged decisions are not approvals and are left out.
 *  `draft`: the one it answered, which places it when the approval kept no context. */
export function decisionJournal(
  decision: PulseDecision,
  place: HqJournalPlacer,
  draft: PulseDraft | null
): HqJournalInput | null {
  if (decision.kind !== 'approval' || decision.outcome === null) {
    return null
  }
  const context = decision.sentContext
  const call = draft?.call
  const where = place({
    worktreeId: context?.worktreeId,
    sessionId: context?.agentSessionId ?? call?.agentSessionId,
    cwd: call?.cwd,
    project: context?.project ?? decision.project ?? draft?.project,
    channel: context?.movedTo ?? hqJournalChannel(context?.service ?? call?.service)
  })
  const to = context?.targetName ?? context?.taskName
  return {
    workspace: hqJournalRoom(where),
    placement: hqJournalPlacement(where),
    kind: HQ_JOURNAL_KIND.approveResult,
    at: decision.decidedAt,
    project: where.project,
    address: null,
    sessionId: context?.agentSessionId ?? call?.agentSessionId ?? null,
    personId: decision.personId,
    title: `${OUTCOME[decision.outcome]}${to ? ` → ${to}` : ''}: ${decision.title}`,
    body: decision.body,
    needs: 'nobody',
    status: 'done',
    replyTo: null,
    refKind: 'decision',
    refId: decision.id,
    links: hqJournalLink(context?.taskUrl),
    source: 'approve-gate',
    dedupeKey: `${HQ_JOURNAL_KIND.approveResult}:${decision.id}`
  }
}

/** A finished agent turn: a report when it said something, and a sighting of its session. */
export function finishedChatJournal(
  item: HqHistorySource & { id: string },
  place: HqJournalPlacer
): { entry: HqJournalInput | null; session: HqSessionInput | null } {
  const chat = readHqFinishedChat(item)
  if (!chat) {
    return { entry: null, session: null }
  }
  const where = place({
    worktreeId: chat.worktreeId,
    sessionId: chat.sessionId,
    project: chat.place?.split(' / ')[0] ?? null
  })
  const workspace = hqJournalRoom(where)
  const said = chat.lastMessage ? oneLine(chat.lastMessage) : ''
  const entry: HqJournalInput | null =
    said.length >= HQ_FEED_SESSION_SAID_MIN
      ? {
          workspace,
          placement: hqJournalPlacement(where),
          kind: HQ_JOURNAL_KIND.chatReport,
          at: chat.finishedAt,
          project: where.project,
          address: null,
          sessionId: chat.sessionId,
          personId: null,
          title: `${chat.title ?? chat.place ?? chat.agent ?? 'Agent'}: ${said}`,
          body: chat.fullMessage ?? chat.lastMessage,
          needs: 'nobody',
          status: 'done',
          replyTo: null,
          refKind: 'inbox',
          refId: item.id,
          source: 'chat-finished',
          dedupeKey: `${HQ_JOURNAL_KIND.chatReport}:${item.id}`
        }
      : null
  const session: HqSessionInput | null = chat.sessionId
    ? {
        sessionId: chat.sessionId,
        address: null,
        agent: chat.agent?.toLowerCase() ?? null,
        worktreeId: chat.worktreeId,
        workspace,
        project: where.project,
        state: 'done',
        contextPct: null,
        parentSessionId: null,
        taskRef: null,
        at: chat.finishedAt
      }
    : null
  return { entry, session }
}
