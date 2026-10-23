// Custom build (hq-plus-journal): one pass over everything the journal follows — waitings and
// answers, Approve's drafts and decisions, finished agent turns, Codex review reports — as the rows
// and session sightings they mean now, each placed in its room.
import type {
  HqJournalEntry,
  HqJournalInput,
  HqJournalQuery,
  HqJournalRecordResult,
  HqSession,
  HqSessionInput
} from '../../shared/hq-journal'
import type {
  PulseDecision,
  PulseDraft,
  PulseInboxItem,
  PulsePerson,
  PulseWaiting
} from '../../shared/pulse-types'
import {
  decisionJournal,
  draftJournal,
  finishedChatJournal,
  waitingJournal
} from './hq-journal-adapters'
import { codexReviewJournal, readHqCodexReviews } from './hq-journal-codex-review'
import { hqPlaceOf, type HqRoomRef, type HqRoomSources } from './hq-journal-rooms'

const DAY_MS = 24 * 60 * 60_000
// Why: a first run fills two weeks back; later runs re-read the same window and add only what is new.
export const HQ_JOURNAL_SYNC_WINDOW_MS = 14 * DAY_MS
const DECISIONS_DEPTH = 2000

export type HqJournalPulse = {
  listWaitings: () => PulseWaiting[]
  listDrafts: () => PulseDraft[]
  listDecisions: (limit: number) => PulseDecision[]
  /** The bell's agent-finished items since `since`, done ones too. */
  listFinishedChats: (since: number) => PulseInboxItem[]
  listPeople: () => PulsePerson[]
  record: (inputs: readonly HqJournalInput[]) => HqJournalRecordResult
  noteSessions: (inputs: readonly HqSessionInput[]) => number
  getSession: (sessionId: string) => HqSession | null
  list: (query: HqJournalQuery) => HqJournalEntry[]
}

function recentWaiting(waiting: PulseWaiting, since: number): boolean {
  return (
    waiting.status === 'open' ||
    waiting.createdAt >= since ||
    (waiting.resolvedAt ?? 0) >= since ||
    (waiting.repliedAt ?? 0) >= since
  )
}

/** Oldest first, so rows land in the order things happened. */
export async function collectHqJournal(
  pulse: HqJournalPulse,
  roomSources: HqRoomSources,
  now: number
): Promise<{ entries: HqJournalInput[]; sessions: HqSessionInput[] }> {
  const since = now - HQ_JOURNAL_SYNC_WINDOW_MS
  const place = (ref: HqRoomRef) => hqPlaceOf(roomSources, ref)
  const names = new Map(pulse.listPeople().map((person) => [person.id, person.name]))
  const personName = (id: string): string | null => names.get(id) ?? null
  const address = (sessionId: string): string | null => pulse.getSession(sessionId)?.address ?? null

  const entries: HqJournalInput[] = []
  for (const waiting of pulse.listWaitings()) {
    if (recentWaiting(waiting, since)) {
      entries.push(...waitingJournal(waiting, place, personName, address))
    }
  }
  const drafts = pulse.listDrafts()
  const decisions = pulse.listDecisions(DECISIONS_DEPTH)
  const answers = new Map(
    decisions.flatMap((decision) => (decision.draftId ? [[decision.draftId, decision]] : []))
  )
  for (const draft of drafts) {
    if (draft.updatedAt >= since || draft.status === 'pending') {
      entries.push(draftJournal(draft, place, answers.get(draft.id) ?? null))
    }
  }
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]))
  for (const decision of decisions) {
    const draft = decision.draftId ? (draftsById.get(decision.draftId) ?? null) : null
    const entry = decision.decidedAt >= since ? decisionJournal(decision, place, draft) : null
    if (entry) {
      entries.push(entry)
    }
  }
  const sessions: HqSessionInput[] = []
  for (const item of pulse.listFinishedChats(since)) {
    const finished = finishedChatJournal(item, place)
    if (finished.entry) {
      entries.push(finished.entry)
    }
    if (finished.session) {
      sessions.push(finished.session)
    }
  }
  const hqPath = roomSources.hqPath
  for (const report of hqPath ? await readHqCodexReviews(hqPath, since) : []) {
    entries.push(...codexReviewJournal(report.fileName, report.text, place))
  }
  return {
    entries: entries.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
    sessions: sessions.sort((a, b) => a.at - b.at)
  }
}
