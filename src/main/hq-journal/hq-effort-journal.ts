// Custom build (hq-plus-ladder): the effort each chat message went with — the classifier's pick, a
// miss that kept the chat's own, or the owner's hand pick — as a journal row the day review counts.
import type { HqJournalInput } from '../../shared/hq-journal'
import { HQ_CHAT_EFFORT_KIND } from '../../shared/hq-ladder'
import type { AutoEffortLogEntry } from '../native-chat/auto-effort/native-chat-auto-effort'
import { hqJournalPlacement, hqJournalRoom, type HqJournalPlacer } from './hq-journal-adapters'

export function effortJournal(entry: AutoEffortLogEntry, place: HqJournalPlacer): HqJournalInput {
  const where = place({ sessionId: entry.sessionId })
  const effort = entry.effort ?? 'default'
  return {
    workspace: hqJournalRoom(where),
    placement: hqJournalPlacement(where),
    kind: HQ_CHAT_EFFORT_KIND,
    at: entry.at,
    project: where.project,
    address: null,
    sessionId: entry.sessionId,
    personId: null,
    title: `${effort} · ${entry.result}: ${entry.message}`,
    body: null,
    needs: 'nobody',
    status: 'done',
    replyTo: null,
    refKind: entry.messageId ? 'message' : null,
    refId: entry.messageId,
    source: `effort:${entry.result}:${effort}`,
    dedupeKey: entry.messageId ? `${HQ_CHAT_EFFORT_KIND}:${entry.messageId}` : null
  }
}
