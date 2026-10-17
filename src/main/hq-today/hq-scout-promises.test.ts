import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PulsePerson,
  PulsePersonInput,
  PulseWaiting,
  PulseWaitingInput
} from '../../shared/pulse-types'
import { importHqScoutPromises } from './hq-scout-promises'

const LINK_A = 'https://acme.slack.com/archives/D1/p1792000000000100'
const LINK_B = 'https://acme.slack.com/archives/C2/p1792000000000200'
let dir: string | null = null

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = null
  }
})

async function hqWith(file: unknown): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'hq-promises-'))
  await mkdir(join(dir, 'slack-scout'))
  await writeFile(join(dir, 'slack-scout', 'promises.json'), JSON.stringify(file))
  return dir
}

function waiting(overrides: Partial<PulseWaiting>): PulseWaiting {
  return {
    id: 'w',
    direction: 'on-me',
    personId: null,
    project: null,
    title: 'Promise',
    detail: null,
    source: 'slack-promise',
    sourceRef: null,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: 0,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null,
    ...overrides
  }
}

function person(overrides: Partial<PulsePerson>): PulsePerson {
  return {
    id: 'p',
    name: 'Someone',
    slackUserId: null,
    clickupUserId: null,
    role: null,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function deps(hq: string, waitings: Partial<PulseWaiting>[], people: Partial<PulsePerson>[]) {
  return {
    hqPath: () => hq,
    listWaitings: () => waitings.map(waiting),
    listPeople: () => people.map(person),
    upsertPerson: vi.fn((input: PulsePersonInput) =>
      person({ id: input.id ?? 'p-new', name: input.name })
    ),
    addWaiting: vi.fn((input: PulseWaitingInput) => waiting({ ...input })),
    closeWaiting: vi.fn()
  }
}

describe('importHqScoutPromises', () => {
  it('records a new promise once, on the person Orca knows by name, without binding the Slack id', async () => {
    const hq = await hqWith({
      promises: [
        {
          permalink: LINK_A,
          person: 'Женя',
          personSlackId: 'U9',
          what: 'Прислать форму',
          due: '2026-10-23'
        },
        { permalink: LINK_B, person: 'Ann', what: 'Already recorded' }
      ]
    })
    const d = deps(
      hq,
      [{ id: 'w1', sourceRef: LINK_B, status: 'cancelled' }],
      [{ id: 'p-z', name: 'Женя', slackUserId: null }]
    )
    await importHqScoutPromises(d)
    expect(d.addWaiting).toHaveBeenCalledOnce()
    expect(d.addWaiting).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'on-me',
        title: 'Прислать форму',
        personId: 'p-z',
        source: 'slack-promise',
        sourceRef: LINK_A,
        dueAt: new Date(2026, 9, 23, 23, 59).getTime()
      })
    )
    expect(d.upsertPerson).not.toHaveBeenCalled()
  })

  it('matches by Slack id before name, creates an unknown person, and closes a kept promise', async () => {
    const hq = await hqWith({
      promises: [
        { permalink: LINK_A, person: 'Evgenii Beliaev', personSlackId: 'U9', what: 'A' },
        { permalink: LINK_B, person: 'Новый', what: 'B' }
      ],
      done: [{ permalink: 'https://acme.slack.com/archives/D1/p1791000000000100', reason: 'sent' }]
    })
    const d = deps(
      hq,
      [
        {
          id: 'w-old',
          sourceRef: 'https://acme.slack.com/archives/D1/p1791000000000100',
          status: 'open'
        }
      ],
      [{ id: 'p-z', name: 'Женя', slackUserId: 'U9' }]
    )
    await importHqScoutPromises(d)
    expect(d.addWaiting.mock.calls.map(([input]) => input.personId)).toEqual(['p-z', 'p-new'])
    expect(d.upsertPerson).toHaveBeenCalledWith({ name: 'Новый' })
    expect(d.closeWaiting).toHaveBeenCalledWith('w-old', 'sent')
  })

  it('never closes a question we wait on or a note, even when the scout names its link', async () => {
    const link = 'https://acme.slack.com/archives/C3/p1791000000000300'
    const hq = await hqWith({ done: [{ permalink: link, reason: 'answered' }] })
    const d = deps(
      hq,
      [
        { id: 'w-ask', direction: 'on-them', source: 'agent', sourceRef: link, status: 'open' },
        { id: 'w-note', direction: 'on-me', source: 'hq-note', sourceRef: link, status: 'open' }
      ],
      []
    )
    await importHqScoutPromises(d)
    expect(d.closeWaiting).not.toHaveBeenCalled()
  })

  it('does nothing without HQ or the file', async () => {
    const d = deps('/nonexistent-hq-path', [], [])
    await importHqScoutPromises(d)
    expect(d.addWaiting).not.toHaveBeenCalled()
  })
})
