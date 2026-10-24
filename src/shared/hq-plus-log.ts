// Custom build (hq-plus-ui): HQ+'s feed as the day's conversation log — every journal row of the day in
// the order it happened, the owner's decisions as cards that stay in place once decided, and the
// bell's open decisions (Approve, people's answers, new reports) folded in where they arrived.
import { HQ_JOURNAL_KIND, type HqJournalEntry } from './hq-journal'
import type { PulseInboxItem } from './pulse-types'
import {
  PULSE_BELL_KIND,
  readPulseBellPaneRef,
  readPulseBellSessionId,
  type PulseBellPaneRef
} from './pulse-bell'
import { readHqFinishedChat } from './hq-chat-history'
import { HQ_SLACK_REQUEST_BELL_KIND } from './hq-slack-request-bell'
import { HQ_INTAKE_KIND } from './hq-slack-intake'
import { OUTGOING_APPROVAL_BELL_KIND } from './outgoing-approval/outgoing-approval-bell'
import { HQ_WAITING_REPLY_KIND } from './hq-waiting-reply-bell'
import { HQ_REPORT_BELL_KIND } from './hq-reports'
import { parseHqPlusReport, type HqPlusReport } from './hq-plus-screen'
import { HQ_REMIND_KIND } from './hq-remind'
import { HQ_DEFERRED_KIND } from './hq-morning-briefing'
import { HQ_CHAT_EFFORT_KIND, HQ_OWNER_DECISION_KIND } from './hq-ladder'

/** HQ+ itself, in a room or above them: an item every room's view shows. */
export const HQ_PLUS_ANY_ROOM = '_all'

/** What the owner answered by hand on a card, kept in the bell's done action. */
export const HQ_PLUS_REPLY_ACTION = 'reply:'

/** `bell`: any other bell item the feed shows instead of a popup, with the item's own buttons. */
export type HqPlusCardType = 'move' | 'approve' | 'reply' | 'wait' | 'report' | 'bell'

const HQ_PLUS_BELL_REPLACED = 'replaced'

/** Custom build (hq-closed-loop): a chat's question the chat itself moved past, or handed over. */
export const HQ_PLUS_DONE_IN_CHAT = 'in-chat'
export const HQ_PLUS_DONE_HANDED_OFF = 'handed-off'

/** Custom build (hq-closed-loop): what a handoff offer asks, said plainly. */
export const HQ_PLUS_HANDOFF_TITLE =
  "A chat's context is full and it saved where it stopped. «New session» continues the work in a new chat"

export const HQ_PLUS_HANDOFF_DONE =
  'Handoff: a new chat continued the work where the old one stopped'

/** How a card was settled: the owner's own words, a button, or the row closing elsewhere. */
export type HqPlusDone =
  | { by: 'reply'; text: string; at: number }
  | { by: 'action'; action: string | null; at: number | null }
  | { by: 'status'; status: string }

type Where = {
  room: string
  project: string | null
  address: string | null
  sessionId: string | null
}

export type HqPlusLogItem =
  | (Where & {
      kind: 'line'
      id: string
      at: number
      tone: 'agent' | 'system' | 'person'
      title: string
      /** Custom build (hq-plus-ui-v2): the journal kind or bell kind it came from, for its badge. */
      journalKind?: string | null
      /** Custom build (hq-plus-ui-v3): the turn's full text, for the card opened in place. */
      body?: string | null
      /** Custom build (hq-plus-ui-v3): the chat's earlier turns this row folds, oldest first. */
      earlier?: readonly { id: string; at: number; title: string }[]
      /** Custom build (hq-closed-loop): the terminal pane of an agent with no chat session. */
      pane?: PulseBellPaneRef | null
    })
  | (Where & { kind: 'me'; id: string; at: number; text: string })
  | (Where & {
      kind: 'card'
      id: string
      at: number
      type: HqPlusCardType
      title: string
      body: string | null
      report: HqPlusReport | null
      open: boolean
      done: HqPlusDone | null
      entry: HqJournalEntry | null
      inbox: PulseInboxItem | null
      /** Custom build (hq-closed-loop): the background job a card is from; its answer goes to the job. */
      job?: string | null
    })

export type HqPlusCard = Extract<HqPlusLogItem, { kind: 'card' }>

/** The bell's kinds that become cards in HQ+'s feed. */
export const HQ_PLUS_CARD_KINDS: ReadonlySet<string> = new Set([
  PULSE_BELL_KIND.agentFinished,
  OUTGOING_APPROVAL_BELL_KIND,
  HQ_WAITING_REPLY_KIND,
  HQ_REPORT_BELL_KIND,
  // Custom build (hq-plus-ui): what used to pop up on the right lands in the feed instead.
  PULSE_BELL_KIND.claudeChatLimit,
  PULSE_BELL_KIND.claudeAuthStop,
  PULSE_BELL_KIND.handoff,
  HQ_SLACK_REQUEST_BELL_KIND,
  HQ_INTAKE_KIND,
  // Custom build (hq-plus-ui-v2): reminders and deferred sessions are background lines with buttons.
  HQ_REMIND_KIND,
  HQ_DEFERRED_KIND
])

/** The chat and project a bell item names, so its card sits in its room and can be answered. */
function whereOfItem(item: PulseInboxItem): Where {
  const finished = readHqFinishedChat(item)
  if (finished) {
    return {
      room: HQ_PLUS_ANY_ROOM,
      project: finished.place?.split(' / ')[0]?.trim() || null,
      address: null,
      sessionId: finished.sessionId
    }
  }
  return {
    ...NOWHERE,
    project: refProject(item.refId),
    sessionId: readPulseBellSessionId(item.refId)
  }
}

/** A bell ref's own `project`, when the producer wrote one (a person's answer, a 👾 intake). */
function refProject(refId: string | null): string | null {
  try {
    const parsed: unknown = refId ? JSON.parse(refId) : null
    const project: unknown =
      parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'project') : null
    return typeof project === 'string' && project ? project : null
  } catch {
    return null
  }
}

/** What «Not now» is kept under: the bell item when there is one, as a journal row may replace the card. */
export function hqPlusNotNowKey(card: HqPlusCard): string {
  return card.inbox ? `inbox:${card.inbox.id}` : card.id
}

const SILENT_KINDS: ReadonlySet<string> = new Set([
  HQ_JOURNAL_KIND.approveResult,
  HQ_JOURNAL_KIND.crossRead,
  'entry.settled',
  // Custom build (hq-plus-links): the trust ladder's bookkeeping, one row per message or decision.
  HQ_CHAT_EFFORT_KIND,
  HQ_OWNER_DECISION_KIND
])

/** Rows that close an earlier row of the same ref. */
const SETTLING_KINDS: ReadonlySet<string> = new Set([
  HQ_JOURNAL_KIND.waitingDone,
  HQ_JOURNAL_KIND.approveResult
])

const ASK_TAIL = 400

/** A line that asks: it ends on «?», or on «?» and its options in brackets. */
export const HQ_PLUS_QUESTION_LINE = /\?\s*(?:\([^()]{1,80}\))?$/

/** A finished turn that ends on a question to the owner waits for him. */
export function hqPlusAsksOwner(text: string | null): boolean {
  const tail = (text ?? '').trim().slice(-ASK_TAIL)
  // Why: a question may end on its options in brackets — «Что применить? (номера / ничего)».
  return /\?\s*(?:\*\*)?\s*(?:\([^()\n]{1,80}\))?\s*$/.test(tail) || /\?\s*\n/.test(tail)
}

const OWNER_SENDER = /^From HQ\+:\s*/

/** A thread message the owner wrote from HQ+, not another chat's. */
export function isHqPlusOwnerMessage(entry: HqJournalEntry): boolean {
  return entry.kind === HQ_JOURNAL_KIND.chatMessage && OWNER_SENDER.test(entry.title)
}

function where(entry: HqJournalEntry): Where {
  return {
    room: entry.workspace,
    project: entry.project,
    address: entry.address,
    sessionId: entry.sessionId
  }
}

const NOWHERE: Where = { room: HQ_PLUS_ANY_ROOM, project: null, address: null, sessionId: null }

function bodyOfMessage(entry: HqJournalEntry): string {
  const body = entry.body ?? entry.title.replace(OWNER_SENDER, '')
  return body.replace(/^> .*\n\n/, '').trim()
}

function inboxDone(item: PulseInboxItem | null): HqPlusDone | null {
  if (!item?.doneAt) {
    return null
  }
  // Why: a chat with no thread address takes the owner's words straight; the bell keeps them.
  return item.doneAction?.startsWith(HQ_PLUS_REPLY_ACTION)
    ? { by: 'reply', text: item.doneAction.slice(HQ_PLUS_REPLY_ACTION.length), at: item.doneAt }
    : { by: 'action', action: item.doneAction, at: item.doneAt }
}

const CHAT_TURN_KINDS: ReadonlySet<string> = new Set([
  HQ_JOURNAL_KIND.chatReport,
  HQ_JOURNAL_KIND.chatMessage,
  HQ_CHAT_EFFORT_KIND
])

/** Custom build (hq-closed-loop): a chat's question is settled once the chat took another turn — the
 *  owner answered in the chat itself — or a new chat took its work over. */
function chatActivity(
  entries: readonly HqJournalEntry[]
): (entry: HqJournalEntry) => HqPlusDone | null {
  const lastTurn = new Map<string, number>()
  const handedOff = new Map<string, number>()
  for (const entry of entries) {
    if (entry.sessionId && CHAT_TURN_KINDS.has(entry.kind)) {
      lastTurn.set(entry.sessionId, Math.max(lastTurn.get(entry.sessionId) ?? 0, entry.at))
    }
    const from =
      entry.kind === HQ_JOURNAL_KIND.sessionHandoff
        ? entry.refId
        : entry.kind === HQ_JOURNAL_KIND.sessionClose
          ? entry.sessionId
          : null
    if (from) {
      handedOff.set(from, Math.max(handedOff.get(from) ?? 0, entry.at))
    }
  }
  return (entry) => {
    const sessionId = entry.sessionId
    if (!sessionId) {
      return null
    }
    if ((handedOff.get(sessionId) ?? 0) > entry.at) {
      return { by: 'status', status: HQ_PLUS_DONE_HANDED_OFF }
    }
    return (lastTurn.get(sessionId) ?? 0) > entry.at
      ? { by: 'status', status: HQ_PLUS_DONE_IN_CHAT }
      : null
  }
}

/**
 * The day's log, oldest first. `since` is where the day starts; what still waits on the owner is kept
 * however old it is. `chatQuestions: 'line'` keeps a chat's question in the chat's own row — the
 * desktop's chat card shows it and takes the answer; the phone's row cannot, so there it stays a card.
 */
export function hqPlusLog(
  entries: readonly HqJournalEntry[],
  inbox: readonly PulseInboxItem[],
  since: number,
  options: { chatQuestions?: 'card' | 'line' } = {}
): HqPlusLogItem[] {
  const items: HqPlusLogItem[] = []
  const inboxById = new Map(inbox.map((item) => [item.id, item]))
  const approvals = new Map(
    inbox
      .filter((item) => item.kind === OUTGOING_APPROVAL_BELL_KIND && item.refId)
      .map((item) => [item.refId ?? '', item])
  )
  const used = new Set<string>()
  const answers = new Map<string, HqJournalEntry>()
  for (const entry of entries) {
    if (isHqPlusOwnerMessage(entry) && entry.replyTo) {
      const known = answers.get(entry.replyTo)
      if (!known || known.at < entry.at) {
        answers.set(entry.replyTo, entry)
      }
    }
  }
  const replyDone = (entry: HqJournalEntry): HqPlusDone | null => {
    const answer = answers.get(entry.id)
    return answer ? { by: 'reply', text: bodyOfMessage(answer), at: answer.at } : null
  }
  const card = (
    entry: HqJournalEntry | null,
    item: PulseInboxItem | null,
    fields: Pick<HqPlusCard, 'type' | 'title' | 'body' | 'open' | 'done'> &
      Partial<Where> &
      Pick<Partial<HqPlusCard>, 'job'>
  ): HqPlusCard => ({
    kind: 'card',
    id: entry ? entry.id : `inbox:${item?.id ?? ''}`,
    at: entry?.at ?? item?.createdAt ?? 0,
    ...(entry ? where(entry) : NOWHERE),
    report: parseHqPlusReport(fields.body),
    entry,
    inbox: item,
    ...fields
  })

  // Why: a card decided today stays where it was, even when it was raised before the day began.
  const settledToday = new Set(
    entries.flatMap((entry) =>
      entry.at >= since && entry.refId && SETTLING_KINDS.has(entry.kind) ? [entry.refId] : []
    )
  )
  const later = chatActivity(entries)
  // Custom build (hq-closed-loop): a terminal agent's question «replaced» by a short follow-up turn
  // (its turn report, say) still waits; only a newer reported turn of the same pane settles it.
  const paneOf = (entry: HqJournalEntry): string | null => {
    const bellItem = entry.refKind === 'inbox' && entry.refId ? inboxById.get(entry.refId) : null
    return bellItem ? (readPulseBellPaneRef(bellItem.refId)?.paneKey ?? null) : null
  }
  const lastPaneTurn = new Map<string, number>()
  for (const entry of entries) {
    const pane = entry.kind === HQ_JOURNAL_KIND.chatReport ? paneOf(entry) : null
    if (pane) {
      lastPaneTurn.set(pane, Math.max(lastPaneTurn.get(pane) ?? 0, entry.at))
    }
  }
  const turnDone = (entry: HqJournalEntry, item: PulseInboxItem | null): HqPlusDone | null => {
    if (item?.doneAction !== HQ_PLUS_BELL_REPLACED) {
      return inboxDone(item)
    }
    const pane = paneOf(entry)
    return pane && (lastPaneTurn.get(pane) ?? 0) > entry.at ? inboxDone(item) : null
  }
  for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
    const asked = entry.needs.startsWith('owner:')
    const ownerOpen = entry.status === 'open' && asked
    // Why: the owner's answer settles the question, and the answered card stays a card.
    const answered = asked && answers.has(entry.id)
    const keptDecided =
      asked &&
      ((entry.refId !== null && settledToday.has(entry.refId)) ||
        (answers.get(entry.id)?.at ?? -Infinity) >= since)
    if (entry.at < since && !ownerOpen && !keptDecided) {
      continue
    }
    if (SILENT_KINDS.has(entry.kind)) {
      continue
    }
    if (entry.kind === HQ_JOURNAL_KIND.chatReport) {
      const item = entry.refKind === 'inbox' && entry.refId ? inboxById.get(entry.refId) : undefined
      if (item) {
        used.add(item.id)
      }
      const explicit = ownerOpen
      const asks = explicit || answered || hqPlusAsksOwner(entry.body)
      const done = asks ? (replyDone(entry) ?? turnDone(entry, item ?? null) ?? later(entry)) : null
      const pane = !entry.sessionId && item ? readPulseBellPaneRef(item.refId) : null
      // Custom build (hq-closed-loop): a chat card answers its own question, so a second card was noise (25.10).
      const inChatRow =
        options.chatQuestions === 'line' && Boolean(entry.sessionId || entry.address || pane)
      // Custom build (hq-closed-loop): only a question still waiting is a card; answered, it is the chat's line.
      if (asks && !done && !inChatRow) {
        items.push(
          card(entry, item ?? null, {
            type: 'move',
            title: entry.title,
            body: entry.body,
            open:
              !done &&
              (explicit ||
                Boolean(item && (!item.doneAt || item.doneAction === HQ_PLUS_BELL_REPLACED))),
            done
          })
        )
      } else {
        if (done?.by === 'reply' && !answers.has(entry.id)) {
          items.push({
            kind: 'me',
            id: `${entry.id}:reply`,
            at: done.at,
            ...where(entry),
            text: done.text
          })
        }
        items.push({
          kind: 'line',
          id: entry.id,
          at: entry.at,
          ...where(entry),
          tone: 'agent',
          title: entry.title,
          body: entry.body,
          journalKind: entry.kind,
          pane
        })
      }
      continue
    }
    if (entry.kind === HQ_JOURNAL_KIND.jobReport) {
      // Custom build (hq-closed-loop): a job's question or what it learned is a card; the rest a quiet line.
      const report = parseHqPlusReport(entry.body)
      if (ownerOpen || answered || report?.learned) {
        const done =
          replyDone(entry) ??
          (asked && !ownerOpen ? { by: 'status' as const, status: 'superseded' } : null)
        items.push(
          card(entry, null, {
            type: 'move',
            title: entry.title,
            body: entry.body,
            open: ownerOpen && !done,
            done,
            job: entry.refId
          })
        )
      } else {
        items.push({
          kind: 'line',
          id: entry.id,
          at: entry.at,
          ...where(entry),
          tone: 'system',
          title: entry.title,
          body: entry.body,
          journalKind: entry.kind
        })
      }
      continue
    }
    if (entry.kind === HQ_JOURNAL_KIND.approveRequest) {
      const item = entry.refId ? (approvals.get(entry.refId) ?? null) : null
      if (item) {
        used.add(item.id)
      }
      // Custom build (hq-plus-side-blocks): an agent's own draft has no bell card; the journal says it waits.
      const agentDraft = !item && entry.refKind === 'draft' && entry.status === 'open'
      const open = ownerOpen && (agentDraft || Boolean(item && !item.doneAt))
      items.push(
        card(entry, item, {
          type: 'approve',
          title: entry.title,
          body: entry.body,
          open,
          done: open ? null : (inboxDone(item) ?? { by: 'status', status: entry.status })
        })
      )
      continue
    }
    if (entry.kind === HQ_JOURNAL_KIND.waitingOpen && entry.needs.startsWith('owner:')) {
      const done = replyDone(entry) ?? (ownerOpen ? null : { by: 'status', status: entry.status })
      items.push(
        card(entry, null, { type: 'wait', title: entry.title, body: entry.body, open: !done, done })
      )
      continue
    }
    if (isHqPlusOwnerMessage(entry)) {
      items.push({
        kind: 'me',
        id: entry.id,
        at: entry.at,
        ...where(entry),
        text: bodyOfMessage(entry)
      })
      continue
    }
    if (entry.kind === HQ_JOURNAL_KIND.reviewFinding && !/^\[P[01]\]/.test(entry.title)) {
      continue
    }
    items.push({
      kind: 'line',
      id: entry.id,
      at: entry.at,
      ...where(entry),
      tone: entry.kind === HQ_JOURNAL_KIND.personReply ? 'person' : 'system',
      title: entry.title,
      journalKind: entry.kind
    })
  }

  const newestReport = new Map<string, number>()
  for (const item of inbox) {
    if (item.kind === HQ_REPORT_BELL_KIND && item.refId) {
      const series = hqPlusReportSeries(item.refId)
      newestReport.set(series, Math.max(newestReport.get(series) ?? 0, item.createdAt))
    }
  }
  for (const item of inbox) {
    if (used.has(item.id) || !HQ_PLUS_CARD_KINDS.has(item.kind)) {
      continue
    }
    // Why: an unanswered report a newer one of its series replaced is no longer the owner's move.
    const superseded =
      item.kind === HQ_REPORT_BELL_KIND &&
      !item.doneAt &&
      item.refId !== null &&
      (newestReport.get(hqPlusReportSeries(item.refId)) ?? 0) > item.createdAt
    // Why: one decided today keeps its folded card, however old it is.
    if (item.createdAt < since && ((item.doneAt !== null && item.doneAt < since) || superseded)) {
      continue
    }
    const done: HqPlusDone | null = superseded
      ? { by: 'status', status: 'superseded' }
      : inboxDone(item)
    if (item.kind === PULSE_BELL_KIND.agentFinished) {
      // Why: the journal skips a short turn («Понял, делаю»); the bell is then its only record.
      if (!hqPlusAsksOwner(item.body)) {
        // Why: with popups off, an unread finish from before the day is still the owner's to see.
        if (item.createdAt >= since || item.doneAt === null) {
          items.push({
            kind: 'line',
            id: `inbox:${item.id}`,
            at: item.createdAt,
            ...whereOfItem(item),
            tone: 'agent',
            title: item.body ?? item.title,
            body: item.body,
            journalKind: item.kind
          })
        }
        continue
      }
      const place = whereOfItem(item)
      items.push(
        card(null, item, {
          type: 'move',
          title: item.title,
          body: item.body,
          open: !done,
          done,
          ...place
        })
      )
      if (done?.by === 'reply') {
        items.push({ kind: 'me', id: `${item.id}:reply`, at: done.at, ...place, text: done.text })
      }
      continue
    }
    // Custom build (hq-closed-loop): a handoff already taken is news, not a decision card.
    if (item.kind === PULSE_BELL_KIND.handoff && done) {
      items.push({
        kind: 'line',
        id: `inbox:${item.id}`,
        at: item.createdAt,
        ...whereOfItem(item),
        tone: 'system',
        title: `${HQ_PLUS_HANDOFF_DONE}${item.body ? ` · ${item.body}` : ''}`,
        journalKind: HQ_JOURNAL_KIND.sessionHandoff
      })
      continue
    }
    const type: HqPlusCardType =
      item.kind === OUTGOING_APPROVAL_BELL_KIND
        ? 'approve'
        : item.kind === HQ_REPORT_BELL_KIND
          ? 'report'
          : item.kind === HQ_WAITING_REPLY_KIND
            ? 'reply'
            : 'bell'
    const title =
      type === 'report'
        ? (item.body ?? item.title)
        : item.kind === PULSE_BELL_KIND.handoff
          ? HQ_PLUS_HANDOFF_TITLE
          : item.title
    items.push(
      card(null, item, { type, title, body: item.body, open: !done, done, ...whereOfItem(item) })
    )
  }
  return items.sort((a, b) => a.at - b.at)
}

/** `updates/codex-review-2026-10-22T18-50.md` → `updates/codex-review`: reports of one kind. */
export function hqPlusReportSeries(path: string): string {
  return path.replace(/[-_]?\d{4}-\d{2}(?:-\d{2})?[^/]*$/, '')
}

/** The cards that still wait on the owner, in the order they came. */
export function hqPlusWaiting(items: readonly HqPlusLogItem[]): HqPlusCard[] {
  return items.filter((item): item is HqPlusCard => item.kind === 'card' && item.open)
}

/** Midnight of the owner's day. */
export function hqPlusDayStart(now: number): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

const CHOICE = /^\s*(?:[-*]\s*)?\*{0,2}\(([a-z\u0430-\u044f1-9])\)\s*\*{0,2}\s*(.+)$/i
const CHOICE_WORDS = 5
const INLINE_CHOICE =
  /\(([a-z\u0430-\u044f1-9])\)\s*([^()?,]{1,40}?)(?=\s*(?:,|\u0438\u043b\u0438|or)?\s*\([a-z\u0430-\u044f1-9]\)|\s*[?.]|\s*$)/giu

/** The lettered options a turn offers — `- **(а) Рекомендую:** …` — as short button labels. */
export function hqPlusChoices(body: string | null): string[] {
  const choices: string[] = []
  for (const line of (body ?? '').split('\n')) {
    const match = CHOICE.exec(line)
    if (!match) {
      continue
    }
    const words = match[2]
      .replace(/\*\*/g, '')
      .replace(/[:.]+$/, '')
      .split(/\s+/)
    const label = words
      .slice(0, CHOICE_WORDS)
      .join(' ')
      .replace(/[:,.;]+$/, '')
    choices.push(`(${match[1]}) ${label}${words.length > CHOICE_WORDS ? '…' : ''}`)
  }
  if (choices.length === 0) {
    // Why: a short question names its options inline — «(а) синий или (б) зелёный?».
    const asked = (body ?? '').split('\n').findLast((line) => line.includes('?')) ?? ''
    for (const match of asked.matchAll(INLINE_CHOICE)) {
      choices.push(`(${match[1]}) ${match[2].trim()}`)
    }
  }
  return choices.slice(0, 4)
}
