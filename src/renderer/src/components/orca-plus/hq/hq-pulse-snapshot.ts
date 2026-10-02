// Custom build (hq): the part of the pulse snapshot HQ shows, read field by field — the runtime's
// answer arrives untyped, and a record that does not fit is dropped rather than trusted.
import type {
  PulseApprovalOutcome,
  PulseDecision,
  PulsePerson,
  PulseWaiting
} from '../../../../../shared/pulse-types'

export type HqPerson = Pick<PulsePerson, 'id' | 'name'>
export type HqWaiting = Pick<
  PulseWaiting,
  'id' | 'direction' | 'title' | 'personId' | 'project' | 'dueAt' | 'createdAt'
>
export type HqDecision = Pick<
  PulseDecision,
  'id' | 'kind' | 'title' | 'outcome' | 'project' | 'decidedAt'
>

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
    dueAt: typeof dueAt === 'number' ? dueAt : null
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
  return { id, title, kind, outcome, project: nullableString(field(record, 'project')), decidedAt }
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
