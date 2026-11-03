// Custom build (hq-in-work, owner 03.11, plan stage 20.11): every few minutes, the conversations that
// wait on the owner are checked against his agent chats — by their link, task or sentence in a chat's
// transcript, and, by the model reading what that chat reports. A match takes the
// card down to «In work in <chat>». The model's calls share the day's 150 with the intake decisions.
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { searchSessionService } from '../ai-vault-search/session-search-service-registry'
import {
  OPENS_EVERY_STRUCTURED_CHAT,
  searchWithStructuredOwners
} from '../ai-vault/structured-session-ownership'
import {
  checkHqInWorkChats,
  findHqInWorkChat,
  hqInWorkQueries,
  type HqInWorkSearch
} from './hq-in-work'
import { hqIntakeBudget } from './hq-intake-decide'
import { generateHqText } from './hq-task-questions'

const PASS_MS = 5 * 60_000
const FIRST_PASS_MS = 60_000
/** Why three days: an announcement handed to a chat the next morning is still the same work. */
const LOOKBACK_MS = 3 * 24 * 60 * 60_000
const DECISIONS_PER_DAY = 150
const MAX_REPORTS = 3
const MODEL = 'sonnet'

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
    const day = new Date(now).setHours(0, 0, 0, 0)
    await checkHqInWorkChats(
      // Why newest first: a chat just opened is where a message was just handed; the backlog can wait.
      sessions.toSorted((a, b) => b.openedAt - a.openedAt),
      left,
      {
        shown: runtime.pulseAttribution().inWork.checked(now - LOOKBACK_MS),
        reports: (sessionId) =>
          runtime
            .pulseListJournal({
              kind: 'chat.report',
              sessionId,
              oldestFirst: true,
              limit: MAX_REPORTS
            })
            .map((entry) => entry.body ?? entry.title),
        budget: () => budget(day),
        generate: (prompt) =>
          generateHqText(
            prompt,
            { emptyResultName: 'in-work check', operation: 'hq-in-work', model: MODEL },
            {
              settings: store.getSettings(),
              cwd: hqPath,
              getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
            }
          ),
        noteChecked: (sessionId, ids) =>
          runtime.pulseAttribution().inWork.noteChecked(sessionId, ids),
        setInWork: (conversationId, sessionId, why, confidence) =>
          runtime.pulseSetConversationInWork(conversationId, sessionId, 'model', why, confidence)
      }
    )
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
