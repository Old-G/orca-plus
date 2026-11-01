// Custom build (hq-ledger-answers, plan 19.13 part 1): the ledger decides by itself whether a message
// it read answers an open waiting — a reply in the question's own thread answers it; a DM from the
// person answers a question asked in that DM or asked nowhere, if the small model says it is about
// it; several questions open to one person — the model picks one (the reply reader's prompts), and
// when it cannot, the ledger would ask the owner «which». A burst of messages is taken once the person
// pauses. In shadow: every judgement is kept as an event, nothing is written to the waitings, and once
// a day the pairs are compared with the reply reader's.
import type { HqLedgerAnswer, HqLedgerAnswerHow } from '../../shared/hq-ledger'
import { slackMessageForOwner } from '../../shared/hq-reply-addressee'
import {
  HQ_WAITING_REPLY_MAX,
  parseSlackThreadRef,
  slackTsAt
} from '../../shared/hq-waiting-replies'
import { HQ_GITLAB_AUTHOR_ID } from '../../shared/hq-mr-watch'
import type { PulseWaiting } from '../../shared/pulse-types'
import type { HqSlackLedgerMessage } from './hq-slack-ledger-reader'
import { HQ_SLACK_DM_WATCH_MS, HQ_SLACK_REPLY_QUIET_MS } from './hq-slack-waiting-replies'

/** Why three days: a judged message must stay judged over a restart's catch-up of the last day. */
const JUDGED_MS = 3 * 24 * 60 * 60_000
/** Why: the reply reader may take a message up to two minutes after it; younger pairs are not compared. */
const SETTLE_MS = 10 * 60_000
const DAY_MS = 24 * 60 * 60_000
const SHOWN = 5

/** A person's message that may answer a waiting. */
export type HqLedgerAnswerMessage = {
  ts: string
  at: number
  user: string | null
  text: string
  /** Where it was said, so one message seen by two waitings is one. */
  place: string
  /** In the question's own thread, or under its ClickUp comment: it answers without the model. */
  inPlace: boolean
}

export type HqLedgerAnswersDeps = {
  listOpen: () => PulseWaiting[]
  personSlackId: (personId: string) => string | null
  /** The name Orca+ knows a Slack user by, for the model's text. */
  name: (userId: string) => string | null
  judged: (since: number) => HqLedgerAnswer[]
  record: (answer: HqLedgerAnswer) => void
  /** Whether DM messages answer the question; a failed check counts as yes (the reply reader's). */
  isAnswer: (question: string, said: string) => Promise<boolean>
  /** Which of several questions the messages answer (its index), or null (the reply reader's). */
  pickAnswer: (questions: readonly string[], said: string) => Promise<number | null>
  now: () => number
}

/** The open waitings a Slack message may answer: its question's thread, or the person's DM. */
export function hqLedgerAnswerWaitings(
  message: HqSlackLedgerMessage,
  owner: string,
  open: readonly PulseWaiting[],
  personSlackId: (personId: string) => string | null
): { waiting: PulseWaiting; inPlace: boolean }[] {
  // Why: a message that @mentions others and not the owner is their talk (hq-reply-addressee).
  if (
    message.bot ||
    !message.user ||
    message.user === owner ||
    !message.text.trim() ||
    !slackMessageForOwner(message.rawText, owner)
  ) {
    return []
  }
  const at = Number(message.ts) * 1000
  return open.flatMap((waiting): { waiting: PulseWaiting; inPlace: boolean }[] => {
    if (waiting.direction !== 'on-them' || waiting.status !== 'open' || at <= waiting.createdAt) {
      return []
    }
    const thread = parseSlackThreadRef(waiting.sourceRef)
    if (
      thread &&
      thread.channel === message.channel &&
      message.threadTs === thread.threadTs &&
      message.ts !== thread.threadTs
    ) {
      return [{ waiting, inPlace: true }]
    }
    // Why only a question asked in a DM or nowhere: one asked on a task or in a channel is not answered
    // by a DM about something else; nor is a week-old one.
    if (!message.channel.startsWith('D') || at - waiting.createdAt > HQ_SLACK_DM_WATCH_MS) {
      return []
    }
    const person = waiting.personId ? personSlackId(waiting.personId) : null
    const inDm = thread
      ? thread.channel === message.channel && (!person || person === message.user)
      : !waiting.sourceRef && person === message.user
    return inDm ? [{ waiting, inPlace: false }] : []
  })
}

type Ready = { waiting: PulseWaiting; messages: HqLedgerAnswerMessage[] }

const keyOf = (message: HqLedgerAnswerMessage): string => `${message.place}:${message.ts}`

/** Waitings that see the same message, together — one message answers one of them. */
function sharingGroups(ready: readonly Ready[]): Ready[][] {
  const groups: Ready[][] = []
  for (const item of ready) {
    const keys = new Set(item.messages.map(keyOf))
    const joined = groups.filter((group) =>
      group.some((other) => other.messages.some((message) => keys.has(keyOf(message))))
    )
    const merged = [...joined.flat(), item]
    for (const group of joined) {
      groups.splice(groups.indexOf(group), 1)
    }
    groups.push(merged)
  }
  return groups
}

export function createHqLedgerAnswers(deps: HqLedgerAnswersDeps): {
  seenSlack: (message: HqSlackLedgerMessage, owner: string) => void
  /** ClickUp comments the reply reader read under a waiting's question that count as its answer. */
  seenClickUp: (waitingId: string, messages: readonly HqLedgerAnswerMessage[]) => void
  judge: () => Promise<number>
} {
  // Why in memory: the Slack reader re-reads the last day on start, so a restart refills it.
  const pending = new Map<string, Map<string, HqLedgerAnswerMessage>>()
  const add = (waitingId: string, message: HqLedgerAnswerMessage): void => {
    const list = pending.get(waitingId) ?? new Map<string, HqLedgerAnswerMessage>()
    list.set(keyOf(message), message)
    pending.set(waitingId, list)
  }

  const describe = (messages: readonly HqLedgerAnswerMessage[]): string =>
    messages
      .map(
        (message) => `${(message.user && deps.name(message.user)) ?? 'Someone'}: ${message.text}`
      )
      .join('\n')
      .slice(0, HQ_WAITING_REPLY_MAX)

  return {
    seenSlack: (message, owner) => {
      for (const { waiting, inPlace } of hqLedgerAnswerWaitings(
        message,
        owner,
        deps.listOpen(),
        deps.personSlackId
      )) {
        add(waiting.id, {
          ts: message.ts,
          at: Number(message.ts) * 1000,
          user: message.user,
          text: message.text,
          place: message.channel,
          inPlace
        })
      }
    },
    seenClickUp: (waitingId, messages) => {
      for (const message of messages) {
        add(waitingId, message)
      }
    },
    judge: async () => {
      const now = deps.now()
      const judged = deps.judged(now - JUDGED_MS)
      const seenBy = new Map<string, Set<string>>()
      const taken = new Set<string>()
      for (const answer of judged) {
        const seen = seenBy.get(answer.waitingId) ?? new Set<string>()
        answer.messages.forEach((ts) => seen.add(ts))
        seenBy.set(answer.waitingId, seen)
        if (answer.ts) {
          answer.messages.forEach((ts) => taken.add(ts))
        }
      }
      const open = new Map(deps.listOpen().map((waiting) => [waiting.id, waiting]))
      const ready: Ready[] = []
      for (const [waitingId, list] of pending) {
        const waiting = open.get(waitingId)
        const seen = seenBy.get(waitingId) ?? new Set<string>()
        // Why newer than all it judged: what came before a judgement was its context then.
        const after = Math.max(0, ...[...seen].map(Number))
        const messages = [...list.values()]
          .filter(
            (message) =>
              !seen.has(message.ts) && !taken.has(message.ts) && Number(message.ts) > after
          )
          .sort((a, b) => Number(a.ts) - Number(b.ts))
        if (!waiting || messages.length === 0) {
          pending.delete(waitingId)
          continue
        }
        // Why: people answer in bursts of short messages; the answer is taken once they pause.
        if ((messages.at(-1)?.at ?? now) > now - HQ_SLACK_REPLY_QUIET_MS) {
          continue
        }
        ready.push({ waiting, messages })
      }
      let paired = 0
      for (const group of sharingGroups(ready)) {
        for (const answer of await judgeGroup(group, deps, describe, now)) {
          deps.record(answer)
          pending.delete(answer.waitingId)
          paired += answer.ts ? 1 : 0
        }
      }
      return paired
    }
  }
}

async function judgeGroup(
  group: readonly Ready[],
  deps: HqLedgerAnswersDeps,
  describe: (messages: readonly HqLedgerAnswerMessage[]) => string,
  now: number
): Promise<HqLedgerAnswer[]> {
  // Why oldest first: the model reads the questions in the order they were asked.
  const ordered = [...group].sort((a, b) => a.waiting.createdAt - b.waiting.createdAt)
  const counts = new Map<string, number>()
  for (const { messages } of ordered) {
    messages.forEach((message) => counts.set(keyOf(message), (counts.get(keyOf(message)) ?? 0) + 1))
  }
  const shared = (message: HqLedgerAnswerMessage): boolean => (counts.get(keyOf(message)) ?? 0) > 1
  let winner: Ready | null = null
  let unsure = false
  if (ordered.length > 1) {
    const contested = new Map<string, HqLedgerAnswerMessage>()
    ordered.forEach(({ messages }) =>
      messages.filter(shared).forEach((message) => contested.set(keyOf(message), message))
    )
    const said = describe([...contested.values()].sort((a, b) => Number(a.ts) - Number(b.ts)))
    const index = await deps
      .pickAnswer(
        ordered.map(({ waiting }) => waiting.title),
        said
      )
      .catch(() => null)
    // Why the oldest in the questions' own thread: there the reply is to the thread, not to a topic.
    const allInPlace = ordered.every(({ messages }) =>
      messages.every((message) => !shared(message) || message.inPlace)
    )
    winner = ordered[index ?? (allInPlace ? 0 : -1)] ?? null
    unsure = winner === null
  }
  const answers: HqLedgerAnswer[] = []
  for (const item of ordered) {
    let messages = item.messages.filter((message) => !shared(message) || item === winner)
    const fromDm = messages.filter(
      (message) => !message.inPlace && !(item === winner && shared(message))
    )
    if (
      fromDm.length > 0 &&
      !(await deps.isAnswer(item.waiting.title, describe(fromDm)).catch(() => true))
    ) {
      messages = messages.filter((message) => !fromDm.includes(message))
    }
    const newest = messages.at(-1)
    const how: HqLedgerAnswerHow = newest
      ? item === winner
        ? 'pick'
        : messages.every((message) => message.inPlace)
          ? 'place'
          : 'dm'
      : unsure && item.messages.some(shared)
        ? 'which'
        : 'none'
    answers.push({
      waitingId: item.waiting.id,
      ts: newest?.ts ?? null,
      messages: item.messages.map((message) => message.ts),
      how,
      at: now
    })
  }
  return answers
}

/** A ClickUp comment as a message the ledger can pair (its ts is the reply reader's form). */
export function hqLedgerClickUpMessage(
  comment: { id: string; body: string; createdAt: number | null; author: { id: string } | null },
  taskId: string
): HqLedgerAnswerMessage {
  return {
    ts: slackTsAt(comment.createdAt ?? 0),
    at: comment.createdAt ?? 0,
    user: comment.author?.id ?? null,
    text: comment.body.trim(),
    place: `clickup:${taskId}`,
    inPlace: true
  }
}

/**
 * The day's comparison, by the message each took for a waiting: the same pair, a pair only the
 * ledger made, one only the reply reader made, and the waitings the ledger would have asked «which».
 * A pair matches when the reader's message is among those the ledger judged together, since the two
 * may cut one burst differently. GitLab's answers (no message) are left out.
 */
export function hqLedgerAnswersLine(
  ledger: readonly HqLedgerAnswer[],
  reader: readonly { waitingId: string; ts: string; authorId: string | null }[],
  now: number
): string {
  const inWindow = (ts: string): boolean => {
    const at = Number(ts) * 1000
    return at > now - DAY_MS - SETTLE_MS && at <= now - SETTLE_MS
  }
  const pairs = ledger.filter((answer) => answer.ts && inWindow(answer.ts))
  const theirs = reader.filter(
    (answer) => answer.authorId !== HQ_GITLAB_AUTHOR_ID && inWindow(answer.ts)
  )
  const covers = (answer: HqLedgerAnswer, ts: string): boolean =>
    answer.ts === ts || answer.messages.includes(ts)
  const onlyReader = theirs.filter(
    (their) =>
      !ledger.some(
        (answer) => answer.ts && answer.waitingId === their.waitingId && covers(answer, their.ts)
      )
  )
  const onlyLedger = pairs.filter(
    (answer) =>
      !reader.some((their) => their.waitingId === answer.waitingId && covers(answer, their.ts))
  )
  const which = ledger.filter(
    (answer) => answer.how === 'which' && answer.messages.some(inWindow)
  ).length
  const matched = theirs.length - onlyReader.length
  const list = (items: readonly { waitingId: string; ts: string | null }[]): string =>
    `${items
      .slice(0, SHOWN)
      .map((item) => `${item.waitingId.slice(0, 8)}@${item.ts}`)
      .join(', ')}${items.length > SHOWN ? ` and ${items.length - SHOWN} more` : ''}`
  return [
    `Answers, ledger vs reply reader (24 h): ${matched} matched`,
    `only ledger ${onlyLedger.length}${onlyLedger.length > 0 ? ` (${list(onlyLedger)})` : ''}`,
    `only reader ${onlyReader.length}${onlyReader.length > 0 ? ` (${list(onlyReader)})` : ''}`,
    `«which» ${which}`
  ].join('; ')
}
