// Custom build (hq): the part of the pulse snapshot HQ shows, read field by field — the runtime's
// answer arrives untyped, and a record that does not fit is dropped rather than trusted.
import {
  readOutgoingSentContext,
  type OutgoingSentContext
} from './outgoing-approval/outgoing-sent-context'
import type { PulseApprovalOutcome, PulseDecision, PulsePerson, PulseWaiting } from './pulse-types'

export type HqPerson = Pick<PulsePerson, 'id' | 'name'>
export type HqWaiting = Pick<
  PulseWaiting,
  'id' | 'direction' | 'title' | 'personId' | 'project' | 'dueAt' | 'createdAt'
> & {
  /** Custom build (hq-notes): who recorded it; `note` marks a plain note. Absent from older hosts. */
  source?: string
  /** Custom build (hq-waiting-replies): the thread or link it came from, the chat that waits, and the
   *  person's latest answer. Absent from older hosts. */
  sourceRef?: string
  agentSessionId?: string
  worktreeId?: string
  reply?: { text: string; author: string | null; at: number; deliveredAt: number | null }
}
export type HqDecision = Pick<
  PulseDecision,
  'id' | 'kind' | 'title' | 'outcome' | 'project' | 'decidedAt'
> & {
  /** Custom build (hq-done-journal): what was sent, for «Done for you». */
  body?: string
  /** Custom build (hq-sent-history): where an approval's call went and which chat sent it. */
  sent?: OutgoingSentContext
}

export type HqPulse = {
  people: HqPerson[]
  /** Open ones only, newest first. */
  waitings: HqWaiting[]
  /** Newest first. */
  decisions: HqDecision[]
}

const OUTCOMES: readonly PulseApprovalOutcome[] = ['approved', 'edited', 'rejected']

function field(record: object, key: string): unknown {
  return Reflect.get(record, key)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readList<T>(snapshot: object, key: string, read: (record: object) => T | null): T[] {
  const list = field(snapshot, key)
  if (!Array.isArray(list)) {
    return []
  }
  return list.flatMap((entry: unknown) => {
    const parsed = typeof entry === 'object' && entry !== null ? read(entry) : null
    return parsed ? [parsed] : []
  })
}

function readPerson(record: object): HqPerson | null {
  const id = field(record, 'id')
  const name = field(record, 'name')
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : null
}

function readWaiting(record: object): HqWaiting | null {
  const id = field(record, 'id')
  const title = field(record, 'title')
  const direction = field(record, 'direction')
  const createdAt = field(record, 'createdAt')
  const dueAt = field(record, 'dueAt')
  if (typeof id !== 'string' || typeof title !== 'string' || typeof createdAt !== 'number') {
    return null
  }
  if (direction !== 'on-me' && direction !== 'on-them') {
    return null
  }
  return {
    id,
    title,
    direction,
    createdAt,
    personId: nullableString(field(record, 'personId')),
    project: nullableString(field(record, 'project')),
    dueAt: typeof dueAt === 'number' ? dueAt : null,
    ...(typeof field(record, 'source') === 'string'
      ? { source: String(field(record, 'source')) }
      : {}),
    ...readLinks(record),
    ...readReply(record)
  }
}

function readLinks(record: object): Pick<HqWaiting, 'sourceRef' | 'agentSessionId' | 'worktreeId'> {
  const read = (key: string): string | undefined => {
    const value = field(record, key)
    return typeof value === 'string' && value ? value : undefined
  }
  const sourceRef = read('sourceRef')
  const agentSessionId = read('agentSessionId')
  const worktreeId = read('worktreeId')
  return {
    ...(sourceRef ? { sourceRef } : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(worktreeId ? { worktreeId } : {})
  }
}

function readReply(record: object): Pick<HqWaiting, 'reply'> {
  const text = field(record, 'reply')
  const at = field(record, 'repliedAt')
  if (typeof text !== 'string' || !text || typeof at !== 'number') {
    return {}
  }
  const deliveredAt = field(record, 'replyDeliveredAt')
  return {
    reply: {
      text,
      author: nullableString(field(record, 'replyAuthor')),
      at,
      deliveredAt: typeof deliveredAt === 'number' ? deliveredAt : null
    }
  }
}

function readDecision(record: object): HqDecision | null {
  const id = field(record, 'id')
  const title = field(record, 'title')
  const kind = field(record, 'kind')
  const decidedAt = field(record, 'decidedAt')
  if (typeof id !== 'string' || typeof title !== 'string' || typeof decidedAt !== 'number') {
    return null
  }
  if (kind !== 'decision' && kind !== 'approval') {
    return null
  }
  const outcome = OUTCOMES.find((candidate) => candidate === field(record, 'outcome')) ?? null
  const body = nullableString(field(record, 'body'))
  const sent = readOutgoingSentContext(field(record, 'sentContext'))
  return {
    id,
    title,
    kind,
    outcome,
    project: nullableString(field(record, 'project')),
    decidedAt,
    ...(body ? { body } : {}),
    ...(sent ? { sent } : {})
  }
}

/** Null when the answer is not a snapshot at all. */
export function readHqPulse(result: unknown): HqPulse | null {
  if (typeof result !== 'object' || result === null || !Array.isArray(field(result, 'waitings'))) {
    return null
  }
  return {
    people: readList(result, 'people', readPerson),
    waitings: readList(result, 'waitings', readWaiting),
    decisions: readList(result, 'decisions', readDecision)
  }
}

function personKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** The person already known by this name, ignoring case and surrounding spaces. */
export function findPersonByName(people: readonly HqPerson[], name: string): HqPerson | null {
  const key = personKey(name)
  return people.find((person) => personKey(person.name) === key) ?? null
}
