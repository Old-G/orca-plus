// Custom build (claude-account-restart): a packaged app's console goes nowhere, so what the Claude
// account services report also lands in logs/orca-plus-accounts.ndjson.
import { join } from 'node:path'
import { createLocalFileSink, type LocalFileSink } from '../../observability/local-file-sink'
import { getLogsDirectory } from '../../observability/logs-directory'
import { redactString } from '../../observability/redactor'

const ACCOUNT_LOG_PREFIXES = ['[claude-runtime-auth]', '[claude-accounts]', '[claude-limit-guard]']
const LEVELS = ['log', 'info', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]
const MAX_BYTES = 1024 * 1024
const MAX_FILES = 3
const MAX_MESSAGE_CHARS = 4_000

export type AccountLogRecord = { at: string; level: Level; message: string }

function describe(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`
  }
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

/** Null unless the first argument carries an account-service prefix. */
export function toAccountLogRecord(
  level: Level,
  args: unknown[],
  now: Date
): AccountLogRecord | null {
  const first = args[0]
  if (typeof first !== 'string' || !ACCOUNT_LOG_PREFIXES.some((p) => first.startsWith(p))) {
    return null
  }
  const message = redactString(args.map(describe).join(' ')).slice(0, MAX_MESSAGE_CHARS)
  return { at: now.toISOString(), level, message }
}

let sink: LocalFileSink | null = null

export function installAccountLogFile(): void {
  if (sink) {
    return
  }
  const fileSink = createLocalFileSink({
    filePath: join(getLogsDirectory(), 'orca-plus-accounts.ndjson'),
    maxBytes: MAX_BYTES,
    maxFiles: MAX_FILES
  })
  sink = fileSink
  for (const level of LEVELS) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try {
        const record = toAccountLogRecord(level, args, new Date())
        if (record) {
          fileSink.push(record)
        }
      } catch {
        // Why: logging must never break the caller.
      }
    }
  }
}
