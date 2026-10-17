// Custom build (hq-scout-context): what Orca+ knows that the Slack scout cannot see in Slack — whom the
// chats wait for, and what the owner sent people through Approve — written to slack-scout/context.json
// so the scout can tell an answer to our question or an already-answered ask from a new request.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_SLACK_SCOUT_DIR } from '../../shared/hq-slack-scout'
import { HQ_PROMISE_SOURCE } from '../../shared/hq-promises'
import type { PulseDecision, PulseWaiting } from '../../shared/pulse-types'

export const HQ_SCOUT_CONTEXT_FILE = 'context.json'

const SENT_WINDOW_MS = 3 * 24 * 60 * 60_000
const TEXT_MAX = 300
// Why: the scout reads it every run; the chats' asks change on Approve, not by the second.
const REFRESH_MS = 5 * 60_000

export type HqScoutContext = {
  waitings: {
    person: string | null
    title: string
    source: string
    sourceRef: string | null
    since: string
  }[]
  sent: {
    at: string
    to: string | null
    inThread: boolean
    task: string | null
    chat: string | null
    project: string | null
    text: string
  }[]
  /** Custom build (hq-promises): what the owner promised and has not done yet. */
  promises: { person: string | null; what: string; due: string | null; permalink: string }[]
  /** Names Orca+ knows people by, so the scout names a person the same way. */
  people: string[]
}

function oneLine(text: string | null, max: number): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function buildHqScoutContext(
  waitings: readonly PulseWaiting[],
  decisions: readonly PulseDecision[],
  personName: (personId: string) => string | null,
  now: number,
  people: readonly string[] = []
): HqScoutContext {
  return {
    promises: waitings
      .filter(
        (waiting) =>
          waiting.status === 'open' &&
          waiting.direction === 'on-me' &&
          waiting.source === HQ_PROMISE_SOURCE &&
          waiting.sourceRef
      )
      .map((waiting) => ({
        person: waiting.personId ? personName(waiting.personId) : null,
        what: oneLine(waiting.title, TEXT_MAX),
        due: waiting.dueAt === null ? null : new Date(waiting.dueAt).toISOString().slice(0, 10),
        permalink: waiting.sourceRef ?? ''
      })),
    people: [...people],
    waitings: waitings
      .filter((waiting) => waiting.status === 'open' && waiting.direction === 'on-them')
      .map((waiting) => ({
        person: waiting.personId ? personName(waiting.personId) : null,
        title: oneLine(waiting.title, TEXT_MAX),
        source: waiting.source,
        sourceRef: waiting.sourceRef,
        since: new Date(waiting.createdAt).toISOString()
      })),
    sent: decisions
      .filter(
        (decision) =>
          decision.kind === 'approval' &&
          decision.outcome !== 'rejected' &&
          decision.sentContext &&
          /slack|clickup/i.test(decision.sentContext.service ?? '') &&
          now - decision.decidedAt <= SENT_WINDOW_MS
      )
      .map((decision) => {
        const sent = decision.sentContext
        return {
          at: new Date(decision.decidedAt).toISOString(),
          to: sent?.targetName ?? sent?.targetId ?? null,
          inThread: Boolean(sent?.threadTs),
          task: sent?.taskId ?? null,
          chat: sent?.chatName ?? null,
          project: sent?.project ?? null,
          text: oneLine(decision.body, TEXT_MAX)
        }
      })
  }
}

async function writeIfChanged(path: string, text: string): Promise<void> {
  const current = await readFile(path, 'utf8').catch(() => null)
  if (current === text) {
    return
  }
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

export async function writeHqScoutContext(hqPath: string, context: HqScoutContext): Promise<void> {
  const dir = join(hqPath, HQ_SLACK_SCOUT_DIR)
  await mkdir(dir, { recursive: true })
  await writeIfChanged(join(dir, HQ_SCOUT_CONTEXT_FILE), `${JSON.stringify(context, null, 2)}\n`)
}

export function startHqScoutContext(deps: {
  hqPath: () => string | null
  listWaitings: () => PulseWaiting[]
  listDecisions: () => PulseDecision[]
  personName: (personId: string) => string | null
  peopleNames: () => string[]
}): () => void {
  const pass = (): void => {
    const hq = deps.hqPath()
    if (!hq) {
      return
    }
    const context = buildHqScoutContext(
      deps.listWaitings(),
      deps.listDecisions(),
      deps.personName,
      Date.now(),
      deps.peopleNames()
    )
    void writeHqScoutContext(hq, context).catch((error: unknown) =>
      console.warn('[hq-scout-context] write failed:', error)
    )
  }
  pass()
  const timer = setInterval(pass, REFRESH_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
