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
import { hqJobRow } from '../hq-journal/hq-journal-jobs'
import { HQ_JOURNAL_ALL_ROOMS } from '../../shared/hq-journal'

// Why: a new conversation's project and move is a small judgement, like routing a 👾 message.
const GUESS_MODEL = 'haiku'
/** Why: the scout may raise a topic up to 15 minutes after it moved; younger ones are not compared. */
const PARITY_SETTLE_MS = 20 * 60_000
const DAY_MS = 24 * 60 * 60_000
const SLACK_CHANNEL = /^[CDG][A-Z0-9]{6,}$/
const ERROR_REPEAT_MS = 60 * 60_000
let lastError: { found: string; at: number } | null = null

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
): { parity: () => string | null } {
  const cache = createSlackReaderCache()
  const people = () => runtime.pulseListPeople()
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
      now: Date.now
    },
    (error) => {
      console.warn('[hq-slack-ledger] pass failed:', error)
      // Why: a reader failing in silence leaves the conversations stale with no word anywhere.
      const found =
        `Slack DMs and threads not read: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          200
        )
      if (lastError?.found === found && Date.now() - lastError.at < ERROR_REPEAT_MS) {
        return
      }
      lastError = { found, at: Date.now() }
      runtime.pulseRecordJournal([
        hqJobRow(
          { job: 'ledger', found },
          { room: HQ_JOURNAL_ALL_ROOMS, project: null, firm: false },
          Date.now()
        )
      ])
    }
  )
  return {
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
