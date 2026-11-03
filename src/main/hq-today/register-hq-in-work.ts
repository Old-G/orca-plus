// Custom build (hq-in-work, owner 03.11, plan stage 20.11): every few minutes, the conversations that
// wait on the owner are checked against his agent chats — by their link, task or sentence in a chat's
// transcript, and, once per new chat, by the model reading what that chat reports. A match takes the
// card down to «In work in <chat>». The model's calls share the day's 150 with the intake decisions.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { searchSessionService } from '../ai-vault-search/session-search-service-registry'
import {
  OPENS_EVERY_STRUCTURED_CHAT,
  searchWithStructuredOwners
} from '../ai-vault/structured-session-ownership'
import {
  findHqInWorkChat,
  hqInWorkChatPrompt,
  hqInWorkQueries,
  parseHqInWorkChatAnswer,
  type HqInWorkSearch
} from './hq-in-work'
import { hqIntakeBudget } from './hq-intake-decide'
import { generateHqText } from './hq-task-questions'

const PASS_MS = 5 * 60_000
const FIRST_PASS_MS = 60_000
/** Why three days: an announcement handed to a chat the next morning is still the same work. */
const LOOKBACK_MS = 3 * 24 * 60 * 60_000
const DECISIONS_PER_DAY = 150
/** Why: a chat is read once; more than this many new chats in a pass wait for the next one. */
const CHATS_PER_PASS = 3
const MAX_CONVERSATIONS = 10
const MAX_REPORTS = 3
const MODEL = 'sonnet'
/** Why 0.6 (owner, 03.11, live check): a colleague's announcement, handed over in other words, came at 0.6
 *  and a wrong pick at 0.5. A wrong line is one «Not in work» away and counted as a miss. */
const MIN_CONFIDENCE = 0.6

export function startHqInWork(store: Store, runtime: OrcaRuntimeService): () => void {
  const budget = hqIntakeBudget(DECISIONS_PER_DAY, {
    since: (dayStart) => runtime.pulseLedgerDecisionAttemptsSince(dayStart),
    note: () => runtime.pulseNoteLedgerDecisionAttempt()
  })
  const search: HqInWorkSearch = async (query, sinceIso) => {
    const response = await searchWithStructuredOwners(
      searchSessionService(
        {
          query,
          scope: 'conversation',
          limit: 20,
          debug: true,
          filters: { since: sinceIso, sort: 'newest' }
        },
        'ipc'
      ),
      {
        ensureHost: () => runtime.ensureStructuredAgentSessionHost(),
        opensChat: OPENS_EVERY_STRUCTURED_CHAT
      }
    )
    if (response.kind !== 'results') {
      return { exact: false, hits: [] }
    }
    // Why phrase or AND only: an OR match is some of the words, which any chat on the topic has.
    const route = response.debug?.route
    return {
      exact: route === 'phrase' || route === 'and',
      hits: response.hits.map((hit) => ({
        chatSessionId: hit.structuredSession?.sessionId ?? null,
        at: hit.evidence?.timestamp ?? null,
        role: hit.evidence?.role ?? null
      }))
    }
  }

  const pass = async (): Promise<void> => {
    if (store.getSettings().hqLedger === 'off') {
      return
    }
    const now = Date.now()
    const candidates = runtime.pulseListInWorkCandidates(now - LOOKBACK_MS)
    if (candidates.length === 0) {
      return
    }
    const sessions = runtime
      .pulseListRecentSessions(now - LOOKBACK_MS)
      .filter((session) => session.closedAt === null && session.state !== 'closed')
    const open = new Set(sessions.map((session) => session.sessionId))
    const left = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    for (const candidate of candidates) {
      const found = await findHqInWorkChat(
        hqInWorkQueries(candidate.key, candidate.texts),
        candidate.lastAt,
        open,
        search
      )
      if (found) {
        runtime.pulseSetConversationInWork(
          candidate.id,
          found.sessionId,
          'named',
          `the chat holds «${found.query}»`,
          1
        )
        left.delete(candidate.id)
      }
    }
    const hqPath = store.getSettings().hqPath
    if (!hqPath || left.size === 0) {
      return
    }
    const checked = runtime.pulseInWorkChatsChecked(now - LOOKBACK_MS)
    const fresh = sessions
      .filter((session) => !checked.has(session.sessionId))
      // Why newest first: a chat just opened is where a message was just handed; the backlog can wait.
      .toSorted((a, b) => b.openedAt - a.openedAt)
    let read = 0
    for (const session of fresh) {
      const older = [...left.values()].filter((candidate) => candidate.lastAt <= session.openedAt)
      const reports = runtime.pulseListJournal({
        kind: 'chat.report',
        sessionId: session.sessionId,
        oldestFirst: true,
        limit: MAX_REPORTS
      })
      if (older.length === 0 || reports.length === 0) {
        continue
      }
      if (read >= CHATS_PER_PASS || !budget(new Date(now).setHours(0, 0, 0, 0))) {
        return
      }
      read += 1
      runtime.pulseNoteInWorkChatChecked(session.sessionId)
      const offered = older.slice(0, MAX_CONVERSATIONS)
      const generated = await generateHqText(
        hqInWorkChatPrompt(
          {
            sessionId: session.sessionId,
            project: session.project,
            address: session.address ?? session.sessionId,
            reports: reports.map((entry) => entry.body ?? entry.title)
          },
          offered.map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            texts: candidate.texts
          }))
        ),
        { emptyResultName: 'in-work check', operation: 'hq-in-work', model: MODEL },
        {
          settings: store.getSettings(),
          cwd: hqPath,
          getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
        }
      ).catch((error: unknown) => ({ ok: false as const, error: String(error) }))
      const answers = generated.ok
        ? parseHqInWorkChatAnswer(
            generated.text,
            offered.map((candidate) => candidate.id)
          )
        : []
      for (const answer of answers) {
        if (answer.confidence >= MIN_CONFIDENCE) {
          runtime.pulseSetConversationInWork(
            answer.conversationId,
            session.sessionId,
            'model',
            answer.why,
            answer.confidence
          )
          left.delete(answer.conversationId)
        }
      }
    }
  }

  let running = false
  const tick = (): void => {
    if (running) {
      return
    }
    running = true
    void pass()
      .catch((error: unknown) => console.warn('[hq-in-work] pass failed', error))
      .finally(() => {
        running = false
      })
  }
  const first = setTimeout(tick, FIRST_PASS_MS)
  const timer = setInterval(tick, PASS_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
