// Custom build (google-disconnect-forget): HQ keeps no mail of a mailbox once its sign-in goes — the
// ledger's mail threads, the intake's message ids, the reader's cursor — and keeps no mail text past
// 30 days of a thread's quiet. What HQ keeps for its history is its own: ids and times, no text.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_MAIL_STATE_FILE, HQ_SLACK_SCOUT_DIR } from '../../shared/hq-slack-scout'
import { onGmailDisconnected } from '../gmail/gmail-api'
import { HQ_MAIL_KEEP_MS, type HqMailForgetResult } from '../orca-plus/pulse/pulse-ledger-forget'

/** How often quiet mail threads are checked for the 30 days. */
const MAIL_FORGET_EVERY_MS = 6 * 60 * 60_000

// Why: an intake pass that read the old mailbox's ids before a disconnect must not write them back.
let mailboxGeneration = 0
/** Changes on every disconnect. */
export const hqMailboxGeneration = (): number => mailboxGeneration
let forgetWrites = 0

/** The intake's mail ids go; when it last looked stays, so a new sign-in does not re-read old notices. */
export async function forgetHqMailIntakeSeen(hqPath: string): Promise<void> {
  const path = join(hqPath, HQ_SLACK_SCOUT_DIR, HQ_MAIL_STATE_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch {
    return
  }
  let lastCheckAt: number | null = null
  try {
    const raw: unknown = JSON.parse(text)
    const at: unknown = raw && typeof raw === 'object' ? Reflect.get(raw, 'lastCheckAt') : null
    const seen: unknown = raw && typeof raw === 'object' ? Reflect.get(raw, 'seen') : null
    lastCheckAt = typeof at === 'number' ? at : null
    if (Array.isArray(seen) && seen.length === 0) {
      return
    }
  } catch {
    // Unreadable: rewritten without ids, as the intake would read it.
  }
  // Why: not the intake's temp name nor another forget's, so writes at the same moment cannot collide.
  forgetWrites += 1
  const temp = `${path}.${process.pid}.forget-${forgetWrites}.tmp`
  await writeFile(temp, `${JSON.stringify({ lastCheckAt, seen: [] }, null, 2)}\n`)
  await rename(temp, path)
}

/** After an intake pass's writes: when the mailbox went since the pass began (`mailbox`), the ids it
 *  wrote are dropped again and true is returned. */
export async function forgetHqMailIntakeSeenIfGone(
  hqPath: string,
  mailbox: number
): Promise<boolean> {
  if (mailbox === mailboxGeneration) {
    return false
  }
  await forgetHqMailIntakeSeen(hqPath)
  return true
}

export type HqMailForgetDeps = {
  hqPath: () => string | null | undefined
  /** All mail threads without `before`; with it, those quiet since then and old letters of the rest. */
  forgetLedgerMail: (before?: number) => HqMailForgetResult
  /** Drops the mail reader's cursor and ids. */
  resetReader: () => void
  now: () => number
}

/** Forgets the mailbox's mail on a disconnect. `sweepQuiet` forgets old mail text at most every 6 h;
 *  the mail reader's poll calls it, so there is no timer of its own. */
export function registerHqMailForget(deps: HqMailForgetDeps): {
  stop: () => void
  sweepQuiet: () => void
} {
  const stopListening = onGmailDisconnected(() => {
    mailboxGeneration += 1
    deps.resetReader()
    const { conversations } = deps.forgetLedgerMail()
    console.log(`[hq-mail-ledger] mailbox disconnected: ${conversations} mail thread(s) forgotten`)
    const hq = deps.hqPath()
    if (hq) {
      void forgetHqMailIntakeSeen(hq).catch((error: unknown) =>
        console.warn('[hq-mail-intake] could not forget the mailbox ids:', error)
      )
    }
  })
  let sweptAt = -Infinity
  const sweepQuiet = (): void => {
    const now = deps.now()
    if (now - sweptAt < MAIL_FORGET_EVERY_MS) {
      return
    }
    sweptAt = now
    try {
      deps.forgetLedgerMail(now - HQ_MAIL_KEEP_MS)
    } catch (error) {
      console.warn('[hq-mail-ledger] could not forget old mail:', error)
    }
  }
  return { stop: stopListening, sweepQuiet }
}
