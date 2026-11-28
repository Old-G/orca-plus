// Custom build (slack-socket-watchdog): a packaged app's console goes nowhere, so the Socket Mode
// connection's life (connected, closed, no answer to a ping) and how late each pushed reaction
// arrived also land in logs/slack-socket.ndjson. That file answers «is 👾 instant right now?».
import { join } from 'node:path'
import { createLocalFileSink, type LocalFileSink } from '../observability/local-file-sink'
import { getLogsDirectory } from '../observability/logs-directory'
import type { SlackReactionPush } from './slack-reaction-push'

const MAX_BYTES = 512 * 1024
const MAX_FILES = 2

let sink: LocalFileSink | null = null

function fileSink(): LocalFileSink | null {
  if (!sink) {
    try {
      sink = createLocalFileSink({
        filePath: join(getLogsDirectory(), 'slack-socket.ndjson'),
        maxBytes: MAX_BYTES,
        maxFiles: MAX_FILES
      })
    } catch {
      return null
    }
  }
  return sink
}

export function slackSocketLog(message: string, now: Date = new Date()): void {
  console.warn(`[slack] ${message}`)
  try {
    fileSink()?.push({ at: now.toISOString(), message })
  } catch {
    // Why: logging must never break the socket.
  }
}

/** One line per pushed reaction: whose, which emoji, how long after Slack saw it. No message text. */
export function slackReactionLogLine(
  push: SlackReactionPush,
  owner: string | null,
  now: number
): string {
  const who = owner && push.user === owner ? 'owner' : 'someone else'
  const lag = push.at === null ? 'no event time' : `${Math.max(0, now - push.at)} ms after`
  return `reaction :${push.reaction}: by ${who}, ${lag}`
}
