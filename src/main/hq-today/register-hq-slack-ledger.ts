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
  normalizeScoutId,
  startHqSlackLedgerReader
} from './hq-slack-ledger-reader'
import { generateHqText } from './hq-task-questions'

// Why: a new conversation's project and move is a small judgement, like routing a 👾 message.
const GUESS_MODEL = 'haiku'
/** Why: the scout may look at a message up to 15 minutes after it came; younger ones are not compared. */
const PARITY_SETTLE_MS = 20 * 60_000
const DAY_MS = 24 * 60 * 60_000
const SLACK_CHANNEL = /^[CDG][A-Z0-9]{6,}$/

/** Message ids the scout looked at during the last day, settled for comparison. */
function scoutIdsOfDay(hqPath: string, now: number): string[] {
  let seen: unknown
  try {
    const state: unknown = JSON.parse(
      readFileSync(join(hqPath, HQ_SLACK_SCOUT_DIR, 'state.json'), 'utf8')
    )
    seen = state && typeof state === 'object' ? Reflect.get(state, 'seen') : null
  } catch {
    return []
  }
  const ids = new Set<string>()
  for (const raw of seen && typeof seen === 'object' ? Object.keys(seen) : []) {
    const id = normalizeScoutId(raw)
    const [channel, ts] = id.split(':')
    const at = Number(ts) * 1000
    if (
      channel &&
      SLACK_CHANNEL.test(channel) &&
      at > now - DAY_MS &&
      at < now - PARITY_SETTLE_MS
    ) {
      ids.add(`${channel}:${ts}`)
    }
  }
  return [...ids]
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
    (error) => console.warn('[hq-slack-ledger] pass failed:', error)
  )
  return {
    parity: () => {
      const hqPath = store.getSettings().hqPath
      return hqPath
        ? hqSlackParityLine(
            scoutIdsOfDay(hqPath, Date.now()),
            (channel, ts) => runtime.pulseLedgerHasSlackMessage(channel, ts),
            reader.delays()
          )
        : null
    }
  }
}
