// Custom build (hq-plus-person-replies): carries out `person.reply` in HQ/routing.yaml. A person's
// answer that is clear, complete and said where the question was asked goes to the chat that asked
// (or, with that chat closed, to its thread through the dispatcher); anything else stays the owner's
// card, now saying why. Each decision is a journal row, so it is made once and can be looked back on.
import {
  HQ_JOURNAL_MAX_LIMIT,
  hqJournalTitle,
  type HqJournalEntry,
  type HqJournalInput
} from '../../shared/hq-journal'
import {
  HQ_REPLY_CARD_REASON,
  hqReplyAnswered,
  hqReplyCardNote,
  hqReplyPrechecks,
  hqReplyVerdictPrompt,
  hqReplyVerdictReasons,
  parseHqReplyVerdict,
  type HqReplyCardReason,
  type HqReplyRouteAction,
  type HqReplyRule
} from '../../shared/hq-reply-routing'
import { HQ_ROUTING_KIND, HQ_ROUTING_SOURCE } from '../../shared/hq-routing'
import type { HqWaitingReplyPassResult } from '../../shared/hq-waiting-reply-bell'
import { hqWaitingReplyPrompt } from '../../shared/hq-waiting-replies'
import type { PulseWaiting } from '../../shared/pulse-types'
import { journalEntryAsInput } from '../hq-journal/hq-journal-adapters'
import type { HqJournalPulse } from '../hq-journal/hq-journal-collect'

/** An answer still being judged stays out of the bell this long, so it does not pop and vanish. */
export const HQ_REPLY_HOLD_MS = 3 * 60_000
// Why: a model that does not answer is asked again a few minutes later, this many times, then it is a card.
const UNREAD_TRIES = 3
const UNREAD_RETRY_MS = 5 * 60_000
const REF_KIND = 'waiting-reply'

export type HqReplyDispatch = { acted: boolean; how: string; note: string | null }

export type HqReplyRoutingDeps = {
  /** Every waiting on someone else, open or not. */
  listWaitings: () => PulseWaiting[]
  /** The small model's text; null when it could not be asked. */
  judge: (prompt: string) => Promise<string | null>
  /** The owner's own «Pass to chat», with the rule's framing. */
  pass: (
    waitingId: string,
    replyTs: string,
    prompt: (waiting: PulseWaiting) => string
  ) => Promise<HqWaitingReplyPassResult>
  markDelivered: (waitingId: string, replyTs: string) => void
  /** The asking chat's thread, if it has one. */
  address: (sessionId: string) => string | null
  /** The dispatcher, for a thread whose chat is closed; null when there is none. */
  dispatch: (address: string, prompt: string) => Promise<HqReplyDispatch | null>
  roomOf: (project: string | null) => Promise<string>
  personName: (personId: string) => string | null
  pulse: Pick<HqJournalPulse, 'list' | 'record'>
  now: () => number
  log: (message: string) => void
}

export type HqReplyRouteOptions = { dryRun: boolean; since?: number }

export type HqReplyRouting = {
  route: (rule: HqReplyRule | null, options: HqReplyRouteOptions) => Promise<HqReplyRouteAction[]>
  /** For the bell: hold an answer still being judged; else why it waits for the owner. */
  note: (waiting: PulseWaiting) => { hold: boolean; why: string | null }
}

function key(waiting: Pick<PulseWaiting, 'id' | 'replyTs'>): string {
  return `${waiting.id}:${waiting.replyTs ?? ''}`
}

function decidedKey(waiting: Pick<PulseWaiting, 'id' | 'replyTs'>): string {
  return `routing:reply:${key(waiting)}`
}

function pendingAnswer(waiting: PulseWaiting): boolean {
  return (
    waiting.direction === 'on-them' &&
    waiting.status === 'open' &&
    waiting.repliedAt !== null &&
    waiting.replyDeliveredAt === null &&
    Boolean(waiting.replyTs) &&
    Boolean(waiting.reply)
  )
}

export function createHqReplyRouting(deps: HqReplyRoutingDeps): HqReplyRouting {
  const unread = new Map<string, { tries: number; at: number }>()
  /** Card notes by decision key, from this run and the journal. */
  const notes = new Map<string, string>()
  let activeRule = false

  const decided = (): Map<string, HqJournalEntry> => {
    const rows = deps.pulse.list({
      kind: HQ_ROUTING_KIND.action,
      source: HQ_ROUTING_SOURCE,
      since: deps.now() - 14 * 24 * 60 * 60_000,
      limit: HQ_JOURNAL_MAX_LIMIT
    })
    return new Map(
      rows.flatMap((row) =>
        row.refKind === REF_KIND && row.dedupeKey ? [[row.dedupeKey, row] as const] : []
      )
    )
  }

  const author = (waiting: PulseWaiting): string =>
    waiting.replyAuthor ??
    (waiting.personId ? deps.personName(waiting.personId) : null) ??
    'Someone'

  const action = (
    waiting: PulseWaiting,
    kind: HqReplyRouteAction['kind'],
    fields: Partial<HqReplyRouteAction>
  ): HqReplyRouteAction => ({
    kind,
    waitingId: waiting.id,
    replyTs: waiting.replyTs ?? '',
    author: author(waiting),
    question: waiting.title,
    project: waiting.project,
    sessionId: waiting.agentSessionId,
    address: waiting.agentSessionId ? deps.address(waiting.agentSessionId) : null,
    reasons: [],
    answered: null,
    note: null,
    ...fields
  })

  const judge = async (
    waiting: PulseWaiting,
    all: readonly PulseWaiting[]
  ): Promise<{ reasons: HqReplyCardReason[]; answered: string | null } | null> => {
    const reasons = hqReplyPrechecks(waiting, all)
    // Why: a card already for certain needs no model; the owner reads the answer anyway.
    if (reasons.length > 0) {
      return { reasons, answered: null }
    }
    const failed = unread.get(key(waiting))
    if (failed && deps.now() - failed.at < UNREAD_RETRY_MS) {
      return null
    }
    const verdict = parseHqReplyVerdict((await deps.judge(hqReplyVerdictPrompt(waiting))) ?? '')
    if (!verdict) {
      const tries = (failed?.tries ?? 0) + 1
      unread.set(key(waiting), { tries, at: deps.now() })
      return tries >= UNREAD_TRIES
        ? { reasons: [HQ_REPLY_CARD_REASON.unread], answered: null }
        : null
    }
    return { reasons: hqReplyVerdictReasons(verdict), answered: hqReplyAnswered(verdict) }
  }

  const record = async (
    waiting: PulseWaiting,
    done: HqReplyRouteAction,
    title: string,
    open: boolean
  ): Promise<void> => {
    const row: HqJournalInput = {
      workspace: await deps.roomOf(waiting.project),
      kind: HQ_ROUTING_KIND.action,
      project: waiting.project,
      address: done.address,
      sessionId: done.sessionId,
      personId: waiting.personId,
      title: hqJournalTitle(title),
      body: [done.note, `Answer to: ${waiting.title}`].filter(Boolean).join('\n\n'),
      needs: open ? 'owner:decide' : 'nobody',
      status: open ? 'open' : 'done',
      replyTo: null,
      refKind: REF_KIND,
      refId: waiting.id,
      source: HQ_ROUTING_SOURCE,
      dedupeKey: decidedKey(waiting)
    }
    deps.pulse.record([row])
  }

  const passPrompt = (waiting: PulseWaiting): string =>
    hqWaitingReplyPrompt(waiting, { byRule: true })

  const carryOut = async (waiting: PulseWaiting): Promise<HqReplyRouteAction> => {
    const replyTs = waiting.replyTs ?? ''
    const passed = await deps.pass(waiting.id, replyTs, passPrompt)
    const who = author(waiting)
    if (passed.ok) {
      const done = action(waiting, 'pass', {})
      await record(
        waiting,
        done,
        `${who}'s answer passed to ${done.address ?? 'the asking chat'} by rule`,
        false
      )
      return done
    }
    if (passed.reason === 'gone') {
      return action(waiting, 'wait', { note: 'already handled by the owner' })
    }
    const thread = waiting.agentSessionId ? deps.address(waiting.agentSessionId) : null
    const dispatched = thread ? await deps.dispatch(thread, passPrompt(waiting)) : null
    if (dispatched?.acted) {
      deps.markDelivered(waiting.id, replyTs)
      const done = action(waiting, 'dispatch', { address: thread, note: dispatched.how })
      await record(waiting, done, `${who}'s answer handed to ${thread} (${dispatched.how})`, false)
      return done
    }
    const reasons = [HQ_REPLY_CARD_REASON.chatClosed]
    const note = [hqReplyCardNote(reasons, null), dispatched?.note].filter(Boolean).join(' ')
    notes.set(decidedKey(waiting), note)
    const card = action(waiting, 'card', { reasons, note })
    await record(
      waiting,
      card,
      `${who}'s answer waits for the owner: the asking chat is closed`,
      true
    )
    return card
  }

  /** A card the owner has since passed or skipped is nobody's move any more. */
  const settleHandled = (rows: Map<string, HqJournalEntry>, all: readonly PulseWaiting[]): void => {
    const byKey = new Map(all.map((waiting) => [decidedKey(waiting), waiting]))
    const handled = [...rows.values()].filter((row) => {
      const waiting = row.dedupeKey ? byKey.get(row.dedupeKey) : undefined
      return row.status === 'open' && (!waiting || !pendingAnswer(waiting))
    })
    if (handled.length > 0) {
      deps.pulse.record(handled.map((row) => journalEntryAsInput(row, { status: 'done' })))
    }
  }

  return {
    async route(rule, options) {
      activeRule = rule?.do === 'send_to_asking_session'
      // Why: with no rule the owner decides every answer, and no model is asked for nothing.
      if (!rule && !options.dryRun) {
        return []
      }
      const all = deps.listWaitings()
      const rows = decided()
      for (const row of rows.values()) {
        if (row.status === 'open' && row.dedupeKey && row.body) {
          notes.set(row.dedupeKey, row.body.split('\n')[0] ?? '')
        }
      }
      if (!options.dryRun) {
        settleHandled(rows, all)
      }
      const since = options.since ?? rule?.since ?? null
      // Why: answers are judged in the order they came; the store lists newest first.
      const candidates = all
        .toReversed()
        .filter((waiting) =>
          options.dryRun && options.since !== undefined
            ? waiting.direction === 'on-them' && waiting.repliedAt !== null && waiting.reply
            : pendingAnswer(waiting) && !rows.has(decidedKey(waiting))
        )
        .sort((a, b) => (a.repliedAt ?? 0) - (b.repliedAt ?? 0))
      const actions: HqReplyRouteAction[] = []
      for (const waiting of candidates) {
        if (since !== null && (waiting.repliedAt ?? 0) < since) {
          continue
        }
        const judged = await judge(waiting, all)
        if (!judged) {
          actions.push(
            action(waiting, 'wait', { note: 'the model did not answer; asked again later' })
          )
          continue
        }
        const reasons: HqReplyCardReason[] =
          rule?.do === 'card' ? [HQ_REPLY_CARD_REASON.ruleCard, ...judged.reasons] : judged.reasons
        if (reasons.length > 0) {
          const note = hqReplyCardNote(reasons, judged.answered)
          const card = action(waiting, 'card', { reasons, answered: judged.answered, note })
          if (!options.dryRun && rule) {
            notes.set(decidedKey(waiting), note)
            await record(
              waiting,
              card,
              `${card.author}'s answer waits for the owner: ${note}`,
              true
            )
          }
          actions.push(card)
          continue
        }
        if (options.dryRun || !rule) {
          actions.push(action(waiting, 'pass', { answered: judged.answered }))
          continue
        }
        actions.push(
          await carryOut(waiting).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            deps.log(`replies: ${waiting.id} failed: ${message}`)
            return action(waiting, 'wait', { note: message })
          })
        )
      }
      return actions
    },

    note(waiting) {
      const known = notes.get(decidedKey(waiting))
      if (known) {
        return { hold: false, why: known }
      }
      const fresh = (waiting.repliedAt ?? 0) > deps.now() - HQ_REPLY_HOLD_MS
      return { hold: activeRule && fresh, why: null }
    }
  }
}

let provided: HqReplyRouting | null = null

export function provideHqReplyRouting(service: HqReplyRouting | null): void {
  provided = service
}

/** The running app's answer routing, for the bell. */
export function getHqReplyRouting(): HqReplyRouting | null {
  return provided
}
