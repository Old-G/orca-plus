// Custom build (pulse): `orca pulse …` over the pulse.* RPC.
import type {
  PulseAddResult,
  PulseDecision,
  PulseDraft,
  PulsePerson,
  PulseWaiting
} from '../../shared/pulse-types'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import type { RuntimeClient } from '../runtime-client'
import {
  formatDraftList,
  formatPersonShow,
  formatWaitingList,
  type PulsePersonShow
} from '../pulse-format'

const DEFAULT_SOURCE = 'agent'

function oneOfFlag<T extends string>(
  flags: Map<string, string | boolean>,
  name: string,
  allowed: readonly T[]
): T | undefined {
  const value = getOptionalStringFlag(flags, name)
  if (value === undefined) {
    return undefined
  }
  const match = allowed.find((candidate) => candidate === value)
  if (match === undefined) {
    throw new Error(`--${name} must be one of: ${allowed.join(', ')}`)
  }
  return match
}

async function listPeople(client: RuntimeClient): Promise<PulsePerson[]> {
  return (await client.call<PulsePerson[]>('pulse.listPeople')).result
}

/** An id, or a name matched case-insensitively — exact first, then a single partial match. */
function findPerson(people: PulsePerson[], value: string): PulsePerson | 'ambiguous' | null {
  const byId = people.find((person) => person.id === value)
  if (byId) {
    return byId
  }
  const needle = value.toLocaleLowerCase()
  const exact = people.filter((person) => person.name.toLocaleLowerCase() === needle)
  const candidates =
    exact.length > 0
      ? exact
      : people.filter((person) => person.name.toLocaleLowerCase().includes(needle))
  if (candidates.length > 1) {
    return 'ambiguous'
  }
  return candidates[0] ?? null
}

async function personIdFlag(
  client: RuntimeClient,
  flags: Map<string, string | boolean>,
  create: boolean
): Promise<string | undefined> {
  const value = getOptionalStringFlag(flags, 'person')
  if (value === undefined) {
    return undefined
  }
  const people = await listPeople(client)
  const found = findPerson(people, value)
  if (found === 'ambiguous') {
    const names = people
      .filter((p) => p.name.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
      .map((p) => `${p.name} (${p.id})`)
    throw new Error(`--person "${value}" matches several people: ${names.join(', ')}`)
  }
  if (found) {
    return found.id
  }
  if (!create) {
    throw new Error(`No person matches "${value}"`)
  }
  return (await client.call<PulsePerson>('pulse.upsertPerson', { name: value })).result.id
}

function dueFlag(flags: Map<string, string | boolean>): number | undefined {
  const value = getOptionalStringFlag(flags, 'due')
  if (value === undefined) {
    return undefined
  }
  const at = Date.parse(value)
  if (Number.isNaN(at)) {
    throw new Error(`--due must be an ISO date or date-time, got "${value}"`)
  }
  return at
}

function requiredDirection(flags: Map<string, string | boolean>): 'on-me' | 'on-them' {
  const direction = oneOfFlag(flags, 'direction', ['on-me', 'on-them'] as const)
  if (!direction) {
    throw new Error('--direction is required: on-me or on-them')
  }
  return direction
}

const source = (flags: Map<string, string | boolean>): string =>
  getOptionalStringFlag(flags, 'source') ?? DEFAULT_SOURCE

export const PULSE_HANDLERS: Record<string, CommandHandler> = {
  'pulse wait add': async ({ flags, client, json }) => {
    const result = await client.call<PulseWaiting>('pulse.addWaiting', {
      direction: requiredDirection(flags),
      title: getRequiredStringFlag(flags, 'title'),
      personId: await personIdFlag(client, flags, true),
      project: getOptionalStringFlag(flags, 'project'),
      detail: getOptionalStringFlag(flags, 'detail'),
      dueAt: dueFlag(flags),
      source: source(flags),
      sourceRef: getOptionalStringFlag(flags, 'source-ref')
    })
    printResult(result, json, (w) => `Waiting ${w.id}: [${w.direction}] ${w.title}`)
  },

  'pulse wait resolve': async ({ flags, client, json }) => {
    const result = await client.call<PulseWaiting>('pulse.closeWaiting', {
      id: getRequiredStringFlag(flags, 'id'),
      status: flags.get('cancel') === true ? 'cancelled' : 'resolved',
      resolution: getOptionalStringFlag(flags, 'resolution')
    })
    printResult(result, json, (w) => `Waiting ${w.id} ${w.status}: ${w.title}`)
  },

  'pulse wait list': async ({ flags, client, json }) => {
    const status = oneOfFlag(flags, 'status', ['open', 'resolved', 'cancelled', 'all'] as const)
    const [result, people] = await Promise.all([
      client.call<PulseWaiting[]>('pulse.listWaitings', {
        status: status === 'all' ? undefined : (status ?? 'open'),
        direction: oneOfFlag(flags, 'direction', ['on-me', 'on-them'] as const),
        personId: await personIdFlag(client, flags, false),
        project: getOptionalStringFlag(flags, 'project')
      }),
      listPeople(client)
    ])
    printResult(result, json, (waitings) => formatWaitingList(waitings, people, Date.now()))
  },

  'pulse decision log': async ({ flags, client, json }) => {
    const result = await client.call<PulseDecision>('pulse.logDecision', {
      title: getRequiredStringFlag(flags, 'title'),
      body: getOptionalStringFlag(flags, 'body'),
      project: getOptionalStringFlag(flags, 'project'),
      personId: await personIdFlag(client, flags, true),
      source: source(flags)
    })
    printResult(result, json, (d) => `Decision ${d.id}: ${d.title}`)
  },

  'pulse draft add': async ({ flags, client, json }) => {
    const result = await client.call<PulseAddResult<PulseDraft>>('pulse.addDraft', {
      kind:
        oneOfFlag(flags, 'kind', [
          'message',
          'clickup-task',
          'clickup-comment',
          'other'
        ] as const) ?? 'message',
      body: getRequiredStringFlag(flags, 'body'),
      target: getOptionalStringFlag(flags, 'target'),
      title: getOptionalStringFlag(flags, 'title'),
      project: getOptionalStringFlag(flags, 'project'),
      personId: await personIdFlag(client, flags, true),
      fingerprint: getOptionalStringFlag(flags, 'fingerprint'),
      source: source(flags),
      sourceRef: getOptionalStringFlag(flags, 'source-ref')
    })
    printResult(result, json, ({ record, created }) =>
      created
        ? `Draft ${record.id} waits for approval.`
        : `Draft ${record.id} already exists (${record.status}); nothing added.`
    )
  },

  'pulse draft list': async ({ flags, client, json }) => {
    const status = oneOfFlag(flags, 'status', [
      'pending',
      'approved',
      'rejected',
      'sent',
      'failed',
      'all'
    ] as const)
    const result = await client.call<PulseDraft[]>('pulse.listDrafts', {
      status: status === 'all' ? undefined : (status ?? 'pending')
    })
    printResult(result, json, formatDraftList)
  },

  'pulse person show': async ({ flags, client, json }) => {
    const value = getRequiredStringFlag(flags, 'person')
    const people = await listPeople(client)
    const person = findPerson(people, value)
    if (person === 'ambiguous') {
      throw new Error(`"${value}" matches several people; use their id`)
    }
    if (!person) {
      throw new Error(`No person matches "${value}"`)
    }
    const [waitings, decisions] = await Promise.all([
      client.call<PulseWaiting[]>('pulse.listWaitings', { status: 'open', personId: person.id }),
      client.call<PulseDecision[]>('pulse.listDecisions', { limit: 100 })
    ])
    const show: PulsePersonShow = {
      person,
      waitings: waitings.result,
      decisions: decisions.result.filter((d) => d.personId === person.id).slice(0, 10)
    }
    printResult({ ...waitings, result: show }, json, (s) => formatPersonShow(s, Date.now()))
  }
}
