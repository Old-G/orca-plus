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

/** Threads read whole the reader remembers, and threads it still owes a read. */
const THREADS_REMEMBERED = 2_000
const THREADS_PENDING = 200
/** A thread that failed this many reads is left as its found messages. */
const THREAD_TRIES = 5

/** A thread still to be read whole. */
export type HqSlackPendingThread = { channel: string; threadTs: string; dm: boolean; tries: number }
/** Custom build (hq-ledger-context): which threads were read whole, which are still owed. */
export type HqSlackThreadQueue = { read: string[]; pending: HqSlackPendingThread[] }

/**
 * Custom build (hq-ledger-context, owner 03.11): a message in a thread not read whole yet brings the
 * whole thread, root first — a mention halfway down a channel thread is about the thread. Why a queue
 * (Codex 03.11): a thread over the pass's limit, or one whose read failed, is read on a later pass even
 * though its found messages are already in the ledger.
 */
export async function withWholeThreads(
  api: HqSlackLedgerReadApi,
  found: readonly HqSlackLedgerMessage[],
  queue: HqSlackThreadQueue
): Promise<{
  messages: HqSlackLedgerMessage[]
  threads: Map<string, HqSlackLedgerMessage[]>
  fetched: Set<string>
  queue: HqSlackThreadQueue
}> {
  const byId = new Map(found.map((message) => [`${message.channel}:${message.ts}`, message]))
  const threads = new Map<string, HqSlackLedgerMessage[]>()
  const fetched = new Set<string>()
  if (!api.thread) {
    return { messages: [...byId.values()], threads, fetched, queue }
  }
  const read = new Set(queue.read)
  const pending = new Map(
    queue.pending.map((thread) => [`${thread.channel}:${thread.threadTs}`, thread])
  )
  for (const message of found) {
    const place = `${message.channel}:${message.threadTs}`
    if (message.threadTs && !read.has(place) && !pending.has(place)) {
      pending.set(place, {
        channel: message.channel,
        threadTs: message.threadTs,
        dm: message.dm,
        tries: 0
      })
    }
  }
  for (const [place, thread] of [...pending].slice(0, THREADS_PER_PASS)) {
    let whole: HqSlackLedgerMessage[]
    try {
      whole = await api.thread(thread.channel, thread.threadTs, thread.dm)
    } catch (error) {
      console.warn(`[hq-slack-ledger] thread ${place} not read:`, error)
      if (thread.tries + 1 >= THREAD_TRIES) {
        // Why (Codex 03.11): marked read, so its message in the next search overlap does not queue it
        // again with fresh tries.
        pending.delete(place)
        read.add(place)
      } else {
        pending.set(place, { ...thread, tries: thread.tries + 1 })
      }
      continue
    }
    pending.delete(place)
    read.add(place)
    threads.set(place, whole)
    for (const line of whole) {
      const id = `${line.channel}:${line.ts}`
      if (!byId.has(id)) {
        byId.set(id, line)
        fetched.add(id)
      }
    }
  }
  return {
    messages: [...byId.values()],
    threads,
    fetched,
    queue: {
      read: [...read].slice(-THREADS_REMEMBERED),
      pending: [...pending.values()].slice(-THREADS_PENDING)
    }
  }
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
