// Custom build (hq-intake-decide, owner 03.11, plan stage 20.3): how the Slack ledger asks for a new
// conversation's place — the larger model's whole decision (project, chat, card kind, certainty, why)
// with the open chats, the author's open questions and the owner's past corrections in view; the small
// model's guess when the day's decisions are spent or the larger one gave nothing usable.
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { slackTextLinks } from '../slack/slack-reader-api'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import type { HqLedgerDecision } from '../orca-plus/pulse/pulse-ledger-decision'
import { guessHqLedger } from './hq-ledger-guess'
import { decideHqIntake, type HqIntakeChatOption } from './hq-intake-decide'
import type { HqSlackLedgerDeps } from './hq-slack-ledger-reader'
import { generateHqText } from './hq-task-questions'

// Why sonnet (owner, 03.11): linking a message to the right chat needs more than routing does.
const DECIDE_MODEL = 'sonnet'
const GUESS_MODEL = 'haiku'
/** Why: tens of new talks a day; a runaway day falls back to the small model, not to a bill. */
const DECISIONS_PER_DAY = 150
const CHATS_WINDOW_MS = 3 * 24 * 60 * 60_000

export function hqIntakeDecider(
  store: Store,
  runtime: OrcaRuntimeService
): Pick<HqSlackLedgerDeps, 'guess' | 'setGuess'> {
  const spent = { day: '', count: 0 }
  const liveChats = (): HqIntakeChatOption[] => {
    const since = Date.now() - CHATS_WINDOW_MS
    const reports = new Map<string, string>()
    for (const entry of runtime.pulseListJournal({ kind: 'chat.report', since, limit: 300 })) {
      if (entry.sessionId && !reports.has(entry.sessionId)) {
        reports.set(entry.sessionId, entry.title)
      }
    }
    return runtime
      .pulseListRecentSessions(since)
      .filter((session) => session.closedAt === null && session.state !== 'closed')
      .toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map((session) => ({
        sessionId: session.sessionId,
        project: session.project,
        title: session.address ?? session.sessionId,
        lastReport: reports.get(session.sessionId) ?? null
      }))
  }
  return {
    guess: async (message, author, fromOwner, context) => {
      const hqPath = store.getSettings().hqPath
      if (!hqPath) {
        return null
      }
      const person = runtime.pulseListPeople().find((entry) => entry.slackUserId === message.user)
      const waitings = person
        ? runtime
            .pulseListWaitings({ status: 'open' })
            .filter((waiting) => waiting.personId === person.id)
        : []
      const input = {
        author,
        fromOwner,
        dm: message.dm,
        text: message.text,
        links: slackTextLinks(message.rawText),
        context
      }
      const generate = (model: string) => (prompt: string) =>
        generateHqText(
          prompt,
          { emptyResultName: 'ledger guess', operation: 'hq-ledger-guess', model },
          {
            settings: store.getSettings(),
            cwd: hqPath,
            getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
          }
        )
      const pages = () => listHqProjectPages(hqPath)
      const day = new Date().toDateString()
      if (spent.day !== day) {
        spent.day = day
        spent.count = 0
      }
      if (spent.count < DECISIONS_PER_DAY) {
        spent.count += 1
        const decision = await decideHqIntake(
          {
            ...input,
            chats: liveChats(),
            waitings: waitings.map((waiting) => ({
              title: waiting.title,
              project: waiting.project,
              sessionId: waiting.agentSessionId
            })),
            hints: runtime.pulseAttributionHints(`slack:${message.channel}:`)
          },
          { pages, generate: generate(DECIDE_MODEL) }
        )
        if (decision) {
          return decision
        }
      }
      return guessHqLedger(input, {
        pages,
        authorProjects: () =>
          waitings.flatMap((waiting) => (waiting.project ? [waiting.project] : [])),
        generate: generate(GUESS_MODEL)
      })
    },
    setGuess: (id, guess: HqLedgerGuess | HqLedgerDecision) =>
      'chat' in guess
        ? runtime.pulseSetLedgerDecision(id, guess)
        : runtime.pulseSetLedgerGuess(id, guess)
  }
}
