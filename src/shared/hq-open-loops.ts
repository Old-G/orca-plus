// Custom build (hq-open-loops): open loops found without a model, from the request ledger's
// messages. Someone waits on the owner when their message to him stays unanswered for a day; he waits
// on someone when his question stays unanswered for three. A thanks or an "ok" of theirs answers
// nothing and waits on nobody; a second message of the same side (a bump) keeps the first one's clock.
// What a rule cannot tell is marked disputed and left to the evening check by a model.
import {
  clickUpMentionNames,
  namesMatch,
  slackMentionIds,
  slackMessageForOwner
} from './hq-reply-addressee'
import {
  hqLoopAck,
  hqLoopAsk,
  hqLoopQuestion,
  hqLoopTimeBound,
  hqLoopWithdrawn
} from './hq-open-loop-text'

export const HQ_OPEN_LOOP_ON_ME_MS = 24 * 60 * 60_000
export const HQ_OPEN_LOOP_ON_THEM_MS = 72 * 60 * 60_000
/** Why: past this many messages a thread or task holds several talks; whose move it is needs a reader. */
export const HQ_OPEN_LOOP_LONG_THREAD = 15

export type HqLoopDirection = 'on-me' | 'on-them'
export type HqLoopDisputed =
  /** His only question is inside a quoted or forwarded message. */
  | 'quoted-question'
  | 'long-thread'
  /** The ask names more than one person. */
  | 'many-addressees'
  /** Someone other than the person waited on answered. */
  | 'other-answered'
  /** The person answered with a question back. */
  | 'counter-question'
  /** The only reply is a thanks or an ok: maybe a yes, maybe not. */
  | 'ack-reply'
  /** The owner asked again before the reply came: which ask it answers is unclear. */
  | 'several-asks'
  /** A DM reply in a later talk: a DM mixes topics. */
  | 'dm-later'
  /** The ask names a time of today; by the time it is overdue it may be moot. */
  | 'time-bound'

export type HqLoopMessage = {
  /** The ledger conversation the message is in (for a DM, one of its talks). */
  key: string
  ts: string
  at: number
  fromOwner: boolean
  author: string | null
  authorId: string | null
  text: string
  link: string | null
}

export type HqLoopTimeline = {
  /** A DM's channel (`slack:D…`), else the conversation key. */
  id: string
  kind: 'dm' | 'thread' | 'clickup'
  /** Oldest first. */
  messages: readonly HqLoopMessage[]
}

export type HqLoopOwner = {
  slackIds: readonly string[]
  /** The names ClickUp comments mention him by. */
  names: readonly string[]
}

export type HqOpenLoop = {
  /** `<timeline>#<direction>#<opening ts>`: one loop, one record. */
  id: string
  timeline: string
  direction: HqLoopDirection
  /** The message the clock runs from. */
  opening: HqLoopMessage
  /** Who the loop is with; both null when only a DM says who. */
  person: string | null
  personId: string | null
  dueAt: number
  disputed: HqLoopDisputed | null
}

export type HqLoopAnswer =
  | { kind: 'answer'; message: HqLoopMessage }
  | {
      kind: 'disputed'
      why: 'counter-question' | 'other-answered' | 'ack-reply' | 'several-asks' | 'dm-later'
      message: HqLoopMessage
    }

const DM_KEY = /^(slack:D[A-Z0-9]+):/

/** The timeline a ledger conversation belongs to: a DM's talks are one, the rest are themselves. */
export function hqLoopTimelineOf(key: string): { id: string; kind: HqLoopTimeline['kind'] } {
  const dm = DM_KEY.exec(key)
  if (dm) {
    return { id: dm[1], kind: 'dm' }
  }
  return { id: key, kind: key.startsWith('clickup:') ? 'clickup' : 'thread' }
}

type Side = { owner: HqLoopOwner; names: readonly string[]; kind: HqLoopTimeline['kind'] }

function sideOf(timeline: HqLoopTimeline, owner: HqLoopOwner): Side {
  const names = [
    ...owner.names,
    ...timeline.messages.flatMap((message) => (message.author ? [message.author] : []))
  ]
  return { owner, names, kind: timeline.kind }
}

function counts(message: HqLoopMessage, side: Side): boolean {
  return message.fromOwner || !hqLoopAck(message.text, side.names)
}

function isOwnerName(name: string, owner: HqLoopOwner): boolean {
  return owner.names.some((ownerName) => namesMatch(name, ownerName))
}

/** The people a message names, the owner left out: Slack ids, or ClickUp names as written. */
function othersNamed(text: string, side: Side): string[] {
  if (side.kind === 'clickup') {
    return clickUpMentionNames(text).filter((name) => !isOwnerName(name, side.owner))
  }
  return slackMentionIds(text).filter((id) => !side.owner.slackIds.includes(id))
}

function namesOwner(text: string, side: Side): boolean {
  if (side.kind === 'clickup') {
    return clickUpMentionNames(text).some((name) => isOwnerName(name, side.owner))
  }
  return slackMentionIds(text).some((id) => side.owner.slackIds.includes(id))
}

function speaksToOwner(message: HqLoopMessage, afterOwner: boolean, side: Side): boolean {
  if (side.kind === 'dm' || namesOwner(message.text, side)) {
    return true
  }
  if (!afterOwner) {
    return false
  }
  // Why: right after the owner, a message that names nobody else answers him.
  return side.kind === 'clickup'
    ? clickUpMentionNames(message.text).length === 0
    : side.owner.slackIds.some((id) => slackMessageForOwner(message.text, id))
}

function personNamed(
  name: string,
  timeline: HqLoopTimeline,
  side: Side
): { person: string | null; personId: string | null } {
  if (side.kind === 'clickup') {
    const author = timeline.messages.find((m) => m.author && namesMatch(name, m.author))
    return { person: author?.author ?? name, personId: author?.authorId ?? null }
  }
  const author = timeline.messages.find((m) => m.authorId === name)
  return { person: author?.author ?? null, personId: name }
}

function lastOtherAuthor(messages: readonly HqLoopMessage[]): HqLoopMessage | null {
  return messages.findLast((m) => !m.fromOwner && (m.authorId || m.author)) ?? null
}

/** The loop the timeline's newest exchange leaves open, due or not yet; null when nobody waits.
 *  Either way it takes an ask addressed to the other side — a question or a request. A status, a
 *  report, or an answer to the other side's own ask waits on nobody unless it asks back. */
export function hqOpenLoop(timeline: HqLoopTimeline, owner: HqLoopOwner): HqOpenLoop | null {
  const side = sideOf(timeline, owner)
  const counted = timeline.messages.filter((message) => counts(message, side))
  const last = counted.at(-1)
  if (!last) {
    return null
  }
  const runStart = (end: number): number => {
    let start = end
    while (start > 0 && counted[start - 1].fromOwner === counted[end].fromOwner) {
      start--
    }
    return start
  }
  const start = runStart(counted.length - 1)
  const run = counted.slice(start)
  const before = counted[start - 1] ?? null
  const replying =
    before !== null &&
    counted.slice(runStart(start - 1), start).some((message) => hqLoopAsk(message.text) === 'own')
  // Why: a run that answers the other side's ask is a reply; only a question of its own asks back.
  const asks = (message: HqLoopMessage) =>
    replying ? hqLoopQuestion(message.text) : hqLoopAsk(message.text)
  // Why: once their run names someone else, its next unnamed lines go on talking to them.
  const turnedAway = (message: HqLoopMessage): boolean =>
    run.some((earlier) => earlier.at < message.at && othersNamed(earlier.text, side).length > 0)
  const addressed = (message: HqLoopMessage): boolean =>
    last.fromOwner
      ? side.kind === 'dm' ||
        othersNamed(message.text, side).length > 0 ||
        (before !== null && !before.fromOwner)
      : speaksToOwner(message, before?.fromOwner === true && !turnedAway(message), side)
  const own = run.find((message) => asks(message) === 'own' && addressed(message))
  const opening = own ?? run.find((message) => asks(message) === 'quoted' && addressed(message))
  // Why: whoever asked and then thanked, said «ok» or took the ask back — nobody waits.
  const thanked = timeline.messages.some(
    (message) =>
      message.at > (opening?.at ?? Infinity) &&
      message.fromOwner === last.fromOwner &&
      (hqLoopAck(message.text, side.names) || hqLoopWithdrawn(message.text))
  )
  if (!opening || thanked) {
    return null
  }
  const long = timeline.kind !== 'dm' && counted.length > HQ_OPEN_LOOP_LONG_THREAD
  const named = [...new Set(othersNamed(opening.text, side))]
  const loop = (
    direction: HqLoopDirection,
    person: { person: string | null; personId: string | null }
  ): HqOpenLoop => ({
    id: `${timeline.id}#${direction}#${opening.ts}`,
    timeline: timeline.id,
    direction,
    opening,
    ...person,
    dueAt: opening.at + (direction === 'on-me' ? HQ_OPEN_LOOP_ON_ME_MS : HQ_OPEN_LOOP_ON_THEM_MS),
    disputed: !own
      ? 'quoted-question'
      : timeline.kind !== 'dm' && named.length > (direction === 'on-me' ? 0 : 1)
        ? 'many-addressees'
        : long
          ? 'long-thread'
          : hqLoopTimeBound(opening.text)
            ? 'time-bound'
            : null
  })

  if (!last.fromOwner) {
    return loop('on-me', { person: opening.author, personId: opening.authorId })
  }
  if (named.length > 0) {
    return loop('on-them', personNamed(named[0], timeline, side))
  }
  const other = timeline.kind === 'dm' ? lastOtherAuthor(timeline.messages) : before
  return loop('on-them', { person: other?.author ?? null, personId: other?.authorId ?? null })
}

function samePerson(
  message: HqLoopMessage,
  loop: Pick<HqOpenLoop, 'person' | 'personId'>
): boolean {
  if (loop.personId && message.authorId) {
    return message.authorId === loop.personId
  }
  return !!loop.person && !!message.author && namesMatch(message.author, loop.person)
}

/** What settles a loop. On-me: the owner's next message. On-them: the person's next message that is
 *  more than a thanks and asks nothing back (in a DM, the other side's). Disputed, left for the
 *  evening check and never closed here: a question back, someone else's word, a thanks only, a reply
 *  after the owner asked again, and a DM reply in a later talk (a DM mixes topics; a day later the
 *  reply is as often about something else). */
export function hqLoopAnswer(
  loop: Pick<HqOpenLoop, 'direction' | 'opening' | 'person' | 'personId'>,
  timeline: HqLoopTimeline,
  owner: HqLoopOwner
): HqLoopAnswer | null {
  const index = timeline.messages.findIndex(
    (message) => message.ts === loop.opening.ts && message.key === loop.opening.key
  )
  const after =
    index !== -1
      ? timeline.messages.slice(index + 1)
      : timeline.messages.filter((message) => message.at > loop.opening.at)
  const settled = (message: HqLoopMessage): HqLoopAnswer =>
    timeline.kind === 'dm' && message.key !== loop.opening.key
      ? { kind: 'disputed', why: 'dm-later', message }
      : { kind: 'answer', message }
  if (loop.direction === 'on-me') {
    const reply = after.find((message) => message.fromOwner)
    return reply ? settled(reply) : null
  }
  const side = sideOf(timeline, owner)
  const fromPerson = (message: HqLoopMessage): boolean =>
    !message.fromOwner &&
    (timeline.kind === 'dm' || (!loop.personId && !loop.person) || samePerson(message, loop))
  const words = after.filter((message) => !message.fromOwner && counts(message, side))
  const theirs = words.filter(fromPerson)
  const answer = theirs.find((message) => hqLoopQuestion(message.text) !== 'own')
  if (answer) {
    const askedAgain = after.some(
      (message) => message.fromOwner && message.at < answer.at && hqLoopAsk(message.text) === 'own'
    )
    return askedAgain ? { kind: 'disputed', why: 'several-asks', message: answer } : settled(answer)
  }
  if (theirs[0]) {
    return { kind: 'disputed', why: 'counter-question', message: theirs[0] }
  }
  if (words[0]) {
    return { kind: 'disputed', why: 'other-answered', message: words[0] }
  }
  const ack = after.find(fromPerson)
  return ack ? { kind: 'disputed', why: 'ack-reply', message: ack } : null
}
