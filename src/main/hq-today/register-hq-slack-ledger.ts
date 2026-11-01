// Custom build (hq-request-ledger): the Slack API reader of the request ledger, wired to Orca+ — the
// owner's token, the people Orca+ knows, HQ's project list and the small model.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HQ_SLACK_SCOUT_DIR } from '../../shared/hq-slack-scout'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { withSlackReader } from '../slack/slack-reader'
import { createSlackLedgerApi } from '../slack/slack-ledger-api'
import {
  createSlackReadApi,
  createSlackReaderCache,
  slackTextLinks
} from '../slack/slack-reader-api'
import { guessHqLedger } from './hq-ledger-guess'
import {
  hqSlackParityLine,
  startHqSlackLedgerReader,
  type HqScoutTopic
} from './hq-slack-ledger-reader'
import { generateHqText } from './hq-task-questions'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import {
  createHqLedgerAnswers,
  hqLedgerAnswersLine,
  hqLedgerClickUpMessage
} from './hq-ledger-answers'
import { hqReplyJudges } from './register-hq-waiting-replies'
import type { ClickUpComment } from '../../shared/clickup-types'

// Why: a new conversation's project and move is a small judgement, like routing a 👾 message.
const GUESS_MODEL = 'haiku'
/** Why: the scout may raise a topic up to 15 minutes after it moved; younger ones are not compared. */
const PARITY_SETTLE_MS = 20 * 60_000
const DAY_MS = 24 * 60 * 60_000
const SLACK_CHANNEL = /^[CDG][A-Z0-9]{6,}$/

/**
 * The topics the scout raised that moved during the last day, settled for comparison. Custom build
 * (hq-ledger-sources, 31.10): topics, not `state.json`'s every message looked at — that also holds
 * what the scout skipped as not for the owner.
 */
function scoutTopicsOfDay(hqPath: string, now: number): HqScoutTopic[] {
  let topics: unknown
  try {
    const file: unknown = JSON.parse(
      readFileSync(join(hqPath, HQ_SLACK_SCOUT_DIR, 'topics.json'), 'utf8')
    )
    topics = file && typeof file === 'object' ? (Reflect.get(file, 'topics') ?? file) : null
  } catch {
    return []
  }
  if (!topics || typeof topics !== 'object') {
    return []
  }
  return Object.values(topics).flatMap((topic: unknown) => {
    if (!topic || typeof topic !== 'object') {
      return []
    }
    const id = Reflect.get(topic, 'id')
    const messages = Reflect.get(topic, 'messages')
    const at = Date.parse(String(Reflect.get(topic, 'lastAt') ?? ''))
    const slack = Array.isArray(messages)
      ? messages.filter(
          (message): message is string =>
            typeof message === 'string' && SLACK_CHANNEL.test(message.split(':')[0] ?? '')
        )
      : []
    return typeof id === 'string' &&
      slack.length > 0 &&
      at > now - DAY_MS &&
      at < now - PARITY_SETTLE_MS
      ? [{ id, messages: slack }]
      : []
  })
}

/** Starts the reader; returns the day's parity line for the ledger's report. */
export function registerHqSlackLedger(
  store: Store,
  runtime: OrcaRuntimeService
): {
  parity: () => string | null
  /** The day's line comparing the ledger's answers to waitings with the reply reader's. */
  answers: () => string
  /** ClickUp comments that answer a waiting, from the reply reader's ClickUp read. */
  seenClickUp: (waitingId: string, comments: readonly ClickUpComment[], taskId: string) => void
} {
  const cache = createSlackReaderCache()
  const people = () => runtime.pulseListPeople()
  // Custom build (hq-ledger-answers, plan 19.13 part 1): in shadow — it writes only its own events.
  const answers = createHqLedgerAnswers({
    listOpen: () => runtime.pulseListWaitings({ status: 'open' }),
    personSlackId: (id) => people().find((person) => person.id === id)?.slackUserId ?? null,
    name: (userId) => people().find((person) => person.slackUserId === userId)?.name ?? null,
    judged: (since) => runtime.pulseListLedgerAnswers(since),
    record: (answer) => runtime.pulseRecordLedgerAnswer(answer),
    ...hqReplyJudges(store, runtime),
    now: Date.now
  })
  const reader = startHqSlackLedgerReader(
    {
      enabled: () => store.getSettings().hqLedger !== 'off',
      read: (run) =>
        withSlackReader((token, owner) => {
          const base = createSlackReadApi(token, owner, cache)
          const name = async (userId: string) =>
            people().find((person) => person.slackUserId === userId)?.name ??
            (await base.userName(userId))
          return run(createSlackLedgerApi(token, owner, name, (userId) => base.isBot(userId)))
        }),
      ingest: (signal) => runtime.pulseIngestLedger(signal),
      lastDirection: (key) => runtime.pulseLastLedgerDirection(key),
      guess: (message, author, fromOwner) => {
        const hqPath = store.getSettings().hqPath
        if (!hqPath) {
          return Promise.resolve(null)
        }
        const person = people().find((entry) => entry.slackUserId === message.user)
        return guessHqLedger(
          {
            author,
            fromOwner,
            dm: message.dm,
            text: message.text,
            links: slackTextLinks(message.rawText)
          },
          {
            pages: () => listHqProjectPages(hqPath),
            authorProjects: () =>
              person
                ? runtime
                    .pulseListWaitings({ status: 'open' })
                    .filter((waiting) => waiting.personId === person.id && waiting.project)
                    .map((waiting) => waiting.project ?? '')
                : [],
            generate: (prompt) =>
              generateHqText(
                prompt,
                {
                  emptyResultName: 'ledger guess',
                  operation: 'hq-ledger-guess',
                  model: GUESS_MODEL
                },
                {
                  settings: store.getSettings(),
                  cwd: hqPath,
                  getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
                }
              )
          }
        )
      },
      setGuess: (id, guess) => runtime.pulseSetLedgerGuess(id, guess),
      now: Date.now,
      answers
    },
    // Why: a reader failing in silence leaves the conversations stale with no word anywhere.
    hqLedgerErrorReporter('hq-slack-ledger', 'Slack DMs and threads not read', (rows) =>
      runtime.pulseRecordJournal(rows)
    )
  )
  return {
    answers: () => {
      const since = Date.now() - 2 * DAY_MS
      return hqLedgerAnswersLine(
        runtime.pulseListLedgerAnswers(since),
        runtime.pulseListReaderAnswers(since),
        Date.now()
      )
    },
    seenClickUp: (waitingId, comments, taskId) =>
      answers.seenClickUp(
        waitingId,
        comments.map((comment) => hqLedgerClickUpMessage(comment, taskId))
      ),
    parity: () => {
      const hqPath = store.getSettings().hqPath
      return hqPath
        ? (() => {
            const { delays, gaps } = reader.delays()
            return hqSlackParityLine(
              scoutTopicsOfDay(hqPath, Date.now()),
              (channel, ts) => runtime.pulseLedgerHasSlackMessage(channel, ts),
              delays,
              gaps
            )
          })()
        : null
    }
  }
}
