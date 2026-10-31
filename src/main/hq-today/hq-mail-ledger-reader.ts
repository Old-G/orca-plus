// Custom build (hq-ledger-sources): letters from people in the owner's Gmail, read every two minutes and
// put into the request ledger — the mail intake beside it reads only GitLab and ClickUp notices. One
// mail thread is one conversation: a letter to the owner is his move, a copy only tells, and his own
// reply in a thread that is a conversation closes his move. Bulk mail, robots and notices stay out.
import type { HqLedgerResult, HqLedgerSignal } from '../../shared/hq-ledger'
import { HQ_MAIL_SENDERS, hqMailAddress, type HqLetter } from '../../shared/hq-mail-events'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'

/** The `reader` of the ledger messages this reader writes. */
export const HQ_MAIL_LEDGER_READER = 'gmail-letters'

const POLL_MS = 2 * 60_000
const FIRST_POLL_MS = 50_000
/** Why: the first look goes back a day, like the mail intake and the Slack reader. */
const FIRST_LOOK_MS = 24 * 60 * 60_000
/** Why: Gmail's internalDate can trail the last look by minutes; seen ids stop the repeats. */
const OVERLAP_MS = 30 * 60_000
const LIST_MAX = 200
/** Why: a long absence is read over several passes, not in one that holds the network for minutes. */
const LETTERS_PER_PASS = 30
const GUESSES_PER_PASS = 5
const SEEN_MAX = 2_000
const TEXT_MAX = 2_000
const TITLE_MAX = 100

/** Robots by their address: no-reply, notifications, bounces, calendars. */
const MACHINE_SENDER =
  /no[-_.]?reply|do[-_.]?not[-_.]?reply|notification|mailer-daemon|postmaster|calendar/i
const BULK_PRECEDENCE = /^(?:bulk|list|junk)$/i
const REPLY_PREFIX = /^(?:(?:re|fwd?|aw|wg)\s*(?:\[\d+\])?\s*:\s*)+/i

/** A message as Gmail's search lists it. */
export type HqMailRef = { id: string; threadId: string | null }

/** The two searches: people's letters in the primary inbox, and the owner's own sent mail. */
export function hqMailLedgerQuery(box: 'inbox' | 'sent', since: number): string {
  const after = `after:${Math.floor(since / 1000)}`
  return box === 'inbox' ? `in:inbox category:primary ${after}` : `in:sent ${after}`
}

/** Every address of a To or Cc header, lower-case; commas inside quotes are part of a name. */
export function hqMailAddresses(header: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let angled = false
  for (const char of header) {
    if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === '<') {
      angled = true
    } else if (!quoted && char === '>') {
      angled = false
    }
    if (!quoted && !angled && (char === ',' || char === ';')) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.map(hqMailAddress).filter((address) => address.includes('@'))
}

/** `"Ann Lee" <ann@acme.example>` → `Ann Lee`; a bare address stays itself. */
export function hqMailSenderName(from: string): string {
  const name = from
    .replace(/<[^<>]*>\s*$/, '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
  return name || hqMailAddress(from)
}

/** Why a letter is not a person's, or null when it is: the owner's own, a notice the mail intake
 *  reads, a robot, or mail sent in bulk or by a machine. */
export function hqLetterSkipReason(letter: HqLetter, owner: string): string | null {
  const sender = hqMailAddress(letter.from)
  if (!sender.includes('@')) {
    return 'no sender'
  }
  if (sender === owner) {
    return 'own'
  }
  // Why the subdomain: ClickUp mails from per-task addresses at tasks.clickup.com.
  if (HQ_MAIL_SENDERS.some((known) => known === sender) || sender.endsWith('@tasks.clickup.com')) {
    return 'notice'
  }
  if (MACHINE_SENDER.test(sender.split('@')[0] ?? '')) {
    return 'robot'
  }
  if (letter.listUnsubscribe || BULK_PRECEDENCE.test(letter.precedence?.trim() ?? '')) {
    return 'bulk'
  }
  const auto = letter.autoSubmitted?.trim().toLowerCase()
  return auto && auto !== 'no' ? 'automatic' : null
}

/** The writer's own words: the quoted history and the signature cut off. */
export function hqLetterOwnWords(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    const next = (lines[index + 1] ?? '').trim()
    const quoteHead =
      /^On .{4,300} wrote:$/.test(trimmed) ||
      (/^On .{4,200}$/.test(trimmed) && next.endsWith('wrote:')) ||
      // Why: Gmail in other languages heads the quote with the date and «Name <address>:».
      /<[^<>\s]+@[^<>\s]+>:$/.test(trimmed) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed) ||
      line === '-- '
    if (quoteHead) {
      break
    }
    if (!trimmed.startsWith('>')) {
      kept.push(line)
    }
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function capped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Where the owner opens the thread: his own mailbox, the thread by its id. */
export function hqGmailThreadLink(owner: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(owner)}#all/${encodeURIComponent(threadId)}`
}

/** The ledger signal of one letter: the owner's move when he is in To, news when only copied. */
export function hqLedgerSignalOfLetter(
  letter: HqLetter,
  owner: string,
  fromOwner: boolean
): HqLedgerSignal {
  const subject = letter.subject.replace(/\s+/g, ' ').trim().replace(REPLY_PREFIX, '')
  const words = hqLetterOwnWords(letter.body)
  return {
    key: `gmail:${letter.threadId}`,
    ts: letter.id,
    at: letter.receivedAt,
    author: hqMailSenderName(letter.from),
    authorId: hqMailAddress(letter.from),
    fromOwner,
    text: capped(words || subject, TEXT_MAX),
    link: hqGmailThreadLink(owner, letter.threadId),
    reader: HQ_MAIL_LEDGER_READER,
    forOwner: !fromOwner && hqMailAddresses(letter.to).includes(owner),
    project: null,
    title: capped(subject || '(no subject)', TITLE_MAX)
  }
}

export type HqMailLedgerDeps = {
  enabled: () => boolean
  /** The connected mailbox's address; null when Gmail is not connected. */
  owner: () => string | null
  listRefs: (query: string, max: number) => Promise<HqMailRef[]>
  getLetter: (id: string) => Promise<HqLetter | null>
  ingest: (signal: HqLedgerSignal) => HqLedgerResult
  lastDirection: (key: string) => 'in' | 'out' | null
  /** The small model on a new conversation's first letter; null when it could not say. */
  guess: (letter: HqLetter, signal: HqLedgerSignal) => Promise<HqLedgerGuess | null>
  setGuess: (conversationId: string, guess: HqLedgerGuess) => void
  now: () => number
}

export type HqMailLedgerState = {
  /** When the last pass that read everything began; 0 before the first. */
  cursor: number
  /** Letters already read, newest last. */
  seen: string[]
}

/** One pass: people's letters and the owner's replies into the ledger, a guess for each new thread. */
export async function runHqMailLedgerReader(
  deps: HqMailLedgerDeps,
  state: HqMailLedgerState
): Promise<HqMailLedgerState> {
  const owner = deps.owner()?.trim().toLowerCase()
  if (!owner) {
    return state
  }
  const now = deps.now()
  const since = state.cursor > 0 ? state.cursor - OVERLAP_MS : now - FIRST_LOOK_MS
  const seen = new Set(state.seen)
  const inbox = (await deps.listRefs(hqMailLedgerQuery('inbox', since), LIST_MAX)).filter(
    (ref) => !seen.has(ref.id)
  )
  const threads = new Set(inbox.flatMap((ref) => (ref.threadId ? [ref.threadId] : [])))
  // Why: his sent mail is read only where it answers a conversation, never as a talk of its own.
  const sent = (await deps.listRefs(hqMailLedgerQuery('sent', since), LIST_MAX)).filter(
    (ref) =>
      !seen.has(ref.id) &&
      ref.threadId !== null &&
      (threads.has(ref.threadId) || deps.lastDirection(`gmail:${ref.threadId}`) !== null)
  )
  // Why the oldest first: Gmail lists the newest first; what does not fit waits for the next pass.
  const takeInbox = inbox.toReversed().slice(0, LETTERS_PER_PASS)
  const takeSent = sent.toReversed().slice(0, LETTERS_PER_PASS)
  const left = inbox.length > takeInbox.length || sent.length > takeSent.length
  const letters: { letter: HqLetter; fromOwner: boolean }[] = []
  for (const [refs, fromOwner] of [
    [takeInbox, false],
    [takeSent, true]
  ] as const) {
    for (const ref of refs) {
      const letter = await deps.getLetter(ref.id)
      if (letter) {
        letters.push({ letter, fromOwner })
      } else {
        seen.add(ref.id)
      }
    }
  }
  // Threads a person's letter of this pass opens: the owner's own letter before it starts the talk.
  const opened = new Set(
    letters.flatMap(({ letter, fromOwner }) =>
      !fromOwner && hqLetterSkipReason(letter, owner) === null ? [letter.threadId] : []
    )
  )
  const created = new Set<string>()
  const fresh = new Map<string, { letter: HqLetter; signal: HqLedgerSignal }>()
  // Why oldest first: the ledger's state follows the newest message it was given.
  for (const { letter, fromOwner } of letters.toSorted(
    (a, b) => a.letter.receivedAt - b.letter.receivedAt
  )) {
    const key = `gmail:${letter.threadId}`
    if (fromOwner && !opened.has(letter.threadId) && deps.lastDirection(key) === null) {
      // Why not seen: the thread's letter may come on the next pass, and this reply then closes it.
      continue
    }
    seen.add(letter.id)
    if (!fromOwner && hqLetterSkipReason(letter, owner) !== null) {
      continue
    }
    const signal = hqLedgerSignalOfLetter(letter, owner, fromOwner)
    const result = deps.ingest(signal)
    if (result.added && (result.step === 'new' || result.step === 'owner')) {
      created.add(result.conversationId)
    }
    // Why the person's letter: the model reads what was asked of the owner, not his own words.
    if (!fromOwner && created.has(result.conversationId) && !fresh.has(result.conversationId)) {
      fresh.set(result.conversationId, { letter, signal })
    }
  }
  for (const [conversationId, { letter, signal }] of [...fresh].slice(0, GUESSES_PER_PASS)) {
    const guess = await deps.guess(letter, signal).catch(() => null)
    if (guess) {
      deps.setGuess(conversationId, guess)
    }
  }
  return { cursor: left ? state.cursor : now, seen: [...seen].slice(-SEEN_MAX) }
}

export function startHqMailLedgerReader(
  deps: HqMailLedgerDeps,
  onError: (error: unknown) => void
): { stop: () => void } {
  let state: HqMailLedgerState = { cursor: 0, seen: [] }
  const flight = createDebouncedSingleFlight(
    async () => {
      if (deps.enabled()) {
        state = await runHqMailLedgerReader(deps, state)
      }
    },
    onError,
    FIRST_POLL_MS
  )
  const timer = setInterval(() => void flight.runNow(), POLL_MS)
  timer.unref?.()
  flight.schedule()
  return {
    stop: () => {
      clearInterval(timer)
      flight.dispose()
    }
  }
}
