// Custom build (hq-ledger-context, owner 03.11, plan stage 20.2): what the Slack ledger reads around a
// message so its conversation and the model see the talk, not one line — a thread new to the ledger
// whole, root first; for a new DM talk, the DM lines before it.
import type { HqSlackLedgerMessage, HqSlackLedgerReadApi } from './hq-slack-ledger-reader'

/** Threads new to the ledger read whole per pass; the rest are read on the next one. */
const THREADS_PER_PASS = 10
/** Why 20 lines or 3 days (owner, 03.11): enough to tell what «глянь, пожалуйста» is about. */
const DM_CONTEXT_LINES = 20
const DM_CONTEXT_MS = 3 * 24 * 60 * 60_000
/** At most this many lines around a message go to the model. */
const CONTEXT_LINES = 30

/** A line around a message — the rest of its thread, or the DM before it — that the model reads to
 *  understand the message. */
export type HqSlackLedgerContextLine = { author: string | null; fromOwner: boolean; text: string }

/**
 * Custom build (hq-ledger-context, owner 03.11): a message in a thread the ledger does not hold yet
 * brings the whole thread, root first — a mention halfway down a channel thread is about the thread.
 * One read failing leaves the message as it was found.
 */
export async function withWholeThreads(
  api: HqSlackLedgerReadApi,
  found: readonly HqSlackLedgerMessage[],
  lastDirection: (key: string) => 'in' | 'out' | null
): Promise<{
  messages: HqSlackLedgerMessage[]
  threads: Map<string, HqSlackLedgerMessage[]>
  fetched: Set<string>
}> {
  const byId = new Map(found.map((message) => [`${message.channel}:${message.ts}`, message]))
  const threads = new Map<string, HqSlackLedgerMessage[]>()
  const fetched = new Set<string>()
  const wanted = new Map<string, HqSlackLedgerMessage>()
  for (const message of found) {
    const place = `${message.channel}:${message.threadTs}`
    if (
      message.threadTs &&
      !wanted.has(place) &&
      wanted.size < THREADS_PER_PASS &&
      lastDirection(`slack:${place}`) === null
    ) {
      wanted.set(place, message)
    }
  }
  if (api.thread) {
    for (const [place, message] of wanted) {
      const whole = await api
        .thread(message.channel, message.threadTs ?? message.ts, message.dm)
        .catch((error: unknown) => {
          console.warn(`[hq-slack-ledger] thread ${place} not read:`, error)
          return []
        })
      threads.set(place, whole)
      for (const line of whole) {
        const id = `${line.channel}:${line.ts}`
        if (!byId.has(id)) {
          byId.set(id, line)
          fetched.add(id)
        }
      }
    }
  }
  return { messages: [...byId.values()], threads, fetched }
}

/** The lines around a new talk's first message: the rest of its thread, else the DM before it. */
export async function contextOf(
  api: HqSlackLedgerReadApi,
  message: HqSlackLedgerMessage,
  threads: Map<string, HqSlackLedgerMessage[]>,
  nameOf: (user: string) => Promise<string>
): Promise<HqSlackLedgerContextLine[]> {
  const whole = threads.get(`${message.channel}:${message.threadTs ?? message.ts}`)
  const lines =
    whole ??
    (message.dm && !message.threadTs && api.dmBefore
      ? await api
          .dmBefore(
            message.channel,
            message.ts,
            Math.round(Number(message.ts) * 1000) - DM_CONTEXT_MS,
            DM_CONTEXT_LINES
          )
          .catch(() => [])
      : [])
  const context: HqSlackLedgerContextLine[] = []
  for (const line of lines) {
    if (line.ts === message.ts || line.bot || !line.user) {
      continue
    }
    context.push({
      author: await nameOf(line.user),
      fromOwner: line.user === api.owner,
      text: line.text
    })
  }
  return context.slice(-CONTEXT_LINES)
}
