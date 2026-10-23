// Custom build (pulse): `orca pulse …` over the pulse.* RPC.
import type {
  PulseAddResult,
  PulseDecision,
  PulseDraft,
  PulsePerson,
  PulseWaiting,
  PulseWaitingAdded
} from '../../shared/pulse-types'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import type { RuntimeClient } from '../runtime-client'
import {
  formatDecisionList,
  formatDraftList,
  formatPersonShow,
  formatWaitingList,
  matchesDecisionQuery,
  type PulsePersonShow
} from '../pulse-format'

const DEFAULT_SOURCE = 'agent'
const DECISION_SEARCH_DEPTH = 2000

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
    const result = await client.call<PulseWaitingAdded>('pulse.addWaiting', {
      direction: requiredDirection(flags),
      title: getRequiredStringFlag(flags, 'title'),
      personId: await personIdFlag(client, flags, true),
      project: getOptionalStringFlag(flags, 'project'),
      detail: getOptionalStringFlag(flags, 'detail'),
      dueAt: dueFlag(flags),
      source: source(flags),
      sourceRef: getOptionalStringFlag(flags, 'source-ref'),
      // Custom build (hq-waiting-replies): an answer reaches the chat that recorded the waiting.
      agentSessionId: process.env.ORCA_AGENT_SESSION_ID || undefined,
      paneKey: process.env.ORCA_PANE_KEY || undefined,
      allowDuplicate: flags.get('force') === true || undefined
    })
    printResult(result, json, (w) =>
      w.duplicate
        ? `Already open, not added again: waiting ${w.id}: [${w.direction}] ${w.title} (--force adds anyway; pulse wait update changes it)`
        : `Waiting ${w.id}: [${w.direction}] ${w.title}`
    )
  },

  'pulse wait update': async ({ flags, client, json }) => {
    const due = getOptionalStringFlag(flags, 'due')
    const detail = getOptionalStringFlag(flags, 'detail')
    const result = await client.call<PulseWaiting>('pulse.updateWaiting', {
      id: getRequiredStringFlag(flags, 'id'),
      title: getOptionalStringFlag(flags, 'title'),
      // Custom build (hq-plus-round6): `--detail none` clears it, as `--due none` does the date.
      ...(detail === undefined ? {} : { detail: detail === 'none' ? null : detail }),
      ...(due === undefined ? {} : { dueAt: due === 'none' ? null : dueFlag(flags) })
    })
    printResult(result, json, (w) => `Waiting ${w.id} updated: [${w.direction}] ${w.title}`)
  },

  'pulse wait resolve': async ({ flags, client, json }) => {
    const result = await client.call<PulseWaiting>('pulse.closeWaiting', {
      id: getRequiredStringFlag(flags, 'id'),
      status: flags.get('cancel') === true ? 'cancelled' : 'resolved',
      resolution: getOptionalStringFlag(flags, 'resolution')
    })
    printResult(result, json, (w) => `Waiting ${w.id} ${w.status}: ${w.title}`)
  },

  'pulse wait reopen': async ({ flags, client, json }) => {
    const result = await client.call<PulseWaiting>('pulse.reopenWaiting', {
      id: getRequiredStringFlag(flags, 'id')
    })
    printResult(result, json, (w) => `Waiting ${w.id} open again: ${w.title}`)
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

  // Custom build (hq-ask): «what did we decide about X» reads decisions and sent messages here.
  'pulse decision list': async ({ flags, client, json }) => {
    const query = getOptionalStringFlag(flags, 'query')
    const project = getOptionalStringFlag(flags, 'project')
    const limitFlag = getOptionalStringFlag(flags, 'limit')
    const limit = limitFlag === undefined ? 30 : Number(limitFlag)
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('--limit must be a positive whole number')
    }
    const response = await client.call<PulseDecision[]>('pulse.listDecisions', {
      limit: query || project ? DECISION_SEARCH_DEPTH : limit
    })
    const found = response.result
      .filter(
        (decision) =>
          !project || decision.project === project || decision.sentContext?.project === project
      )
      .filter((decision) => !query || matchesDecisionQuery(decision, query))
      .slice(0, limit)
    printResult({ ...response, result: found }, json, (rows) => formatDecisionList(rows))
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

  // Custom build (hq-clickup-review): a «Разобрать» chat's draft back to its HQ card.
  'pulse review reply': async ({ flags, client, json }) => {
    const result = await client.call<{ ok: true } | { ok: false; error: string }>(
      'hqProjects.replyClickUpReview',
      {
        taskId: getRequiredStringFlag(flags, 'task'),
        reply: getRequiredStringFlag(flags, 'reply'),
        summary: getOptionalStringFlag(flags, 'summary')
      }
    )
    if (!result.result.ok) {
      throw new Error(result.result.error)
    }
    printResult(result, json, () => 'The draft is on its HQ card; the owner sends it.')
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
