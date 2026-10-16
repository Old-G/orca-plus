// Custom build (hq-waiting-replies): keeps the scout's watch list in step with the open waitings,
// takes the answers it found, and hands each one to the chat that waits — once. A chat that cannot
// take it now (closed, not attached) gets it on a later pass.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_SLACK_SCOUT_DIR } from '../../shared/hq-slack-scout'
import {
  HQ_WAITING_REPLIES_FILE,
  HQ_WAITING_WATCH_FILE,
  hqWaitingReplyPrompt,
  hqWaitingWatchEntries,
  parseHqWaitingReplies,
  slackTsAt
} from '../../shared/hq-waiting-replies'
import type { PulseWaiting, PulseWaitingReply } from '../../shared/pulse-types'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'

// Why: the scout writes every 10 minutes; a minute is quick enough for two small file reads.
const REFRESH_MS = 60_000
const DEBOUNCE_MS = 2_000

export type HqWaitingReplyRelayDeps = {
  hqPath: () => string | null
  /** Open waitings, any direction. */
  listOpen: () => PulseWaiting[]
  personName: (personId: string) => string | null
  recordReply: (id: string, reply: PulseWaitingReply) => PulseWaiting | null
  markDelivered: (id: string) => void
  /** True once the native chat took the turn, sent or queued. */
  deliver: (waiting: PulseWaiting, prompt: string) => Promise<boolean>
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function writeIfChanged(path: string, text: string): Promise<void> {
  if ((await readOptional(path)) === text) {
    return
  }
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

export async function relayHqWaitingReplies(deps: HqWaitingReplyRelayDeps): Promise<void> {
  const hq = deps.hqPath()
  if (!hq) {
    return
  }
  const dir = join(hq, HQ_SLACK_SCOUT_DIR)
  const open = deps.listOpen()
  const watch = hqWaitingWatchEntries(open, deps.personName)
  await mkdir(dir, { recursive: true })
  await writeIfChanged(
    join(dir, HQ_WAITING_WATCH_FILE),
    `${JSON.stringify({ waitings: watch }, null, 2)}\n`
  )
  const byId = new Map(open.map((waiting) => [waiting.id, waiting]))
  const replies = parseHqWaitingReplies(
    (await readOptional(join(dir, HQ_WAITING_REPLIES_FILE))) ?? '{}'
  )
  for (const reply of replies) {
    const waiting = byId.get(reply.waitingId)
    // Why: a thread's earlier messages are not answers to a question asked after them.
    if (!waiting || Number(reply.ts) <= Number(slackTsAt(waiting.createdAt))) {
      continue
    }
    const replied = deps.recordReply(waiting.id, {
      text: reply.text,
      author: reply.author,
      ts: reply.ts
    })
    if (replied) {
      byId.set(replied.id, replied)
    }
  }
  for (const waiting of byId.values()) {
    // Why: only a native chat takes the answer; a terminal pane may be a bare shell by now.
    if (
      waiting.repliedAt === null ||
      waiting.replyDeliveredAt !== null ||
      !waiting.agentSessionId
    ) {
      continue
    }
    const delivered = await deps
      .deliver(waiting, hqWaitingReplyPrompt(waiting))
      .catch((error: unknown) => {
        console.warn(`[hq-waiting-replies] delivering ${waiting.id} failed:`, error)
        return false
      })
    if (delivered) {
      deps.markDelivered(waiting.id)
    }
  }
}

export function startHqWaitingReplyRelay(
  deps: HqWaitingReplyRelayDeps & { onChanged: (listener: () => void) => () => void }
): () => void {
  const flight = createDebouncedSingleFlight(
    () => relayHqWaitingReplies(deps),
    (error) => console.warn('[hq-waiting-replies] relay failed:', error),
    DEBOUNCE_MS
  )
  const stop = deps.onChanged(() => flight.schedule())
  const timer = setInterval(() => void flight.runNow(), REFRESH_MS)
  timer.unref?.()
  flight.schedule()
  return () => {
    stop()
    clearInterval(timer)
    flight.dispose()
  }
}
