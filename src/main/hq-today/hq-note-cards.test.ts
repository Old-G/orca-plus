import { describe, expect, it, vi } from 'vitest'
import type { HqRoute } from '../../shared/hq-router'
import {
  HQ_INTAKE_KIND,
  hqIntakeBellItem,
  hqIntakeKey,
  readHqIntake,
  type HqIntake
} from '../../shared/hq-slack-intake'
import type { PulseWaiting } from '../../shared/pulse-types'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { INBOX_GONE_ACTION } from '../orca-plus/pulse/pulse-inbox'
import {
  HQ_NOTE_CARD_KEY_PREFIX,
  HQ_NOTE_CARD_WINDOW_MS,
  hqNoteIntake,
  hqNoteRaisedKeys,
  hqNoteWantsCard,
  raiseHqNoteCards,
  type HqNoteCardDeps
} from './hq-note-cards'

const NOW = 1_800_000_000_000

const route: HqRoute = {
  target: 'worker',
  targetTitle: 'W · billing',
  repoId: 'r1',
  project: 'billing',
  level: 'worker',
  how: 'model',
  why: 'it names DEV-1',
  auto: false,
  alternatives: [],
  confidence: null,
  model: 'Jev'
}

function note(id: string, extra: Partial<PulseWaiting> = {}): PulseWaiting {
  return {
    id,
    direction: 'on-me',
    personId: null,
    project: null,
    title: `Acme MR for DEV-1 is coming (${id})`,
    detail: 'We promised Ann in https://acme.slack.example/archives/C1/p1',
    source: 'slack-promise',
    sourceRef: 'https://acme.slack.example/archives/C1/p1',
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: NOW - 60_000,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null,
    ...extra
  }
}

function setup(notes: PulseWaiting[], options: { answer?: HqRoute | null | 'throw' } = {}) {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => NOW, newId: () => `i${++id}` })
  const saved = new Map<string, { route: HqRoute | null; at: number; tries: number }>()
  const added: HqIntake[] = []
  const closed: string[] = []
  const asked: string[] = []
  const answer = options.answer === undefined ? route : options.answer
  const state = { now: NOW }
  const deps: HqNoteCardDeps = {
    notes: () => notes.filter((entry) => entry.status === 'open'),
    personName: () => 'Ann',
    raised: () => hqNoteRaisedKeys(db.listInbox({ includeDone: true, kind: HQ_INTAKE_KIND })),
    openCards: () =>
      db
        .listInbox({ kind: HQ_INTAKE_KIND })
        .flatMap((item) => (item.dedupeKey ? [{ id: item.id, dedupeKey: item.dedupeKey }] : [])),
    addCard: (intake) => {
      added.push(intake)
      db.addInboxItem({ ...hqIntakeBellItem(intake), kind: HQ_INTAKE_KIND })
    },
    closeCard: (itemId, action) => {
      closed.push(itemId)
      db.markInboxDone(itemId, action)
    },
    route: async (draft) => {
      asked.push(draft.text)
      if (answer === 'throw') {
        throw new Error('model down')
      }
      return answer
    },
    cardRoute: (key) => saved.get(key) ?? null,
    saveCardRoute: (key, routed, at) =>
      void saved.set(key, { route: routed, at, tries: (saved.get(key)?.tries ?? 0) + 1 }),
    now: () => state.now
  }
  return { db, deps, saved, added, closed, asked, state }
}

describe('hqNoteWantsCard', () => {
  it('takes an open line from the owner or a message, young enough', () => {
    expect(hqNoteWantsCard(note('a'), NOW)).toBe(true)
    expect(hqNoteWantsCard(note('a', { source: 'manual' }), NOW)).toBe(true)
  })

  it('leaves an agent reminder, a Later line, a line on them, a closed or an old one', () => {
    expect(hqNoteWantsCard(note('a', { source: 'agent' }), NOW)).toBe(false)
    expect(hqNoteWantsCard(note('a', { source: 'intake' }), NOW)).toBe(false)
    expect(hqNoteWantsCard(note('a', { direction: 'on-them' }), NOW)).toBe(false)
    expect(hqNoteWantsCard(note('a', { status: 'resolved' }), NOW)).toBe(false)
    expect(hqNoteWantsCard(note('a', { createdAt: NOW - HQ_NOTE_CARD_WINDOW_MS - 1 }), NOW)).toBe(
      false
    )
  })
})

describe('hqNoteIntake', () => {
  it('is a router card keyed by the line, with its words and link, no Slack thread', () => {
    const card = hqNoteIntake(note('n1'), 'Ann', NOW)
    expect(hqIntakeKey(card)).toBe(`${HQ_NOTE_CARD_KEY_PREFIX}n1`)
    expect(card).toMatchObject({
      channel: 'note',
      ts: 'n1',
      threadTs: null,
      author: 'Ann',
      pasted: true,
      permalink: 'https://acme.slack.example/archives/C1/p1'
    })
    expect(card.text).toContain('Acme MR for DEV-1')
    expect(card.links).toEqual(['https://acme.slack.example/archives/C1/p1'])
  })
})

describe('raiseHqNoteCards', () => {
  it('raises one card with the router’s line for a line, one call', async () => {
    const { deps, db, saved, added, asked } = setup([note('n1')])
    expect(await raiseHqNoteCards(deps)).toBe(1)
    expect(asked).toHaveLength(1)
    expect(added).toHaveLength(1)
    expect(saved.get('note:n1')?.route).toEqual(route)
    const [item] = db.listInbox({ kind: HQ_INTAKE_KIND })
    expect(item?.dedupeKey).toBe('router:note:n1')
    expect(item?.body).toContain('→ «W · billing» — it names DEV-1')
    expect(readHqIntake(item?.refId ?? null)).toMatchObject({
      channel: 'note',
      project: 'billing',
      route: { target: 'worker', auto: false }
    })
  })

  it('a second pass asks nobody and raises nothing', async () => {
    const { deps, db, added, asked } = setup([note('n1'), note('n2')])
    await raiseHqNoteCards(deps)
    await raiseHqNoteCards(deps)
    await raiseHqNoteCards(deps)
    expect(asked).toHaveLength(2)
    expect(added).toHaveLength(2)
    expect(db.listInbox({ kind: HQ_INTAKE_KIND })).toHaveLength(2)
  })

  it('a line whose card the owner skipped gets no second card and no second call', async () => {
    const { deps, db, asked } = setup([note('n1')])
    await raiseHqNoteCards(deps)
    const [item] = db.listInbox({ kind: HQ_INTAKE_KIND })
    db.markInboxDone(item?.id ?? '', 'skipped')
    await raiseHqNoteCards(deps)
    expect(asked).toHaveLength(1)
    expect(db.listInbox({ includeDone: true, kind: HQ_INTAKE_KIND })).toHaveLength(1)
  })

  it('a card the poll closed by itself is raised again from the kept route, with no call', async () => {
    const { deps, db, asked, added } = setup([note('n1')])
    await raiseHqNoteCards(deps)
    const [item] = db.listInbox({ kind: HQ_INTAKE_KIND })
    db.markInboxDone(item?.id ?? '', INBOX_GONE_ACTION)
    await raiseHqNoteCards(deps)
    expect(asked).toHaveLength(1)
    expect(added).toHaveLength(2)
    expect(db.listInbox({ kind: HQ_INTAKE_KIND })).toHaveLength(1)
  })

  it('a kept route without a card is turned into the card with no call', async () => {
    const { deps, saved, asked, added } = setup([note('n1')])
    saved.set('note:n1', { route, at: NOW - 1_000, tries: 1 })
    await raiseHqNoteCards(deps)
    expect(asked).toHaveLength(0)
    expect(added).toHaveLength(1)
    expect(added[0]?.route?.target).toBe('worker')
  })

  it('leaves a line with no route to Notes, and asks again only after the wait, three times at most', async () => {
    const { deps, added, asked, state } = setup([note('n1')], { answer: null })
    await raiseHqNoteCards(deps)
    await raiseHqNoteCards(deps)
    expect(asked).toHaveLength(1)
    for (let step = 0; step < 4; step += 1) {
      state.now += 31 * 60_000
      await raiseHqNoteCards(deps)
    }
    expect(asked).toHaveLength(3)
    expect(added).toHaveLength(0)
  })

  it('does not count a call that threw, and raises nothing', async () => {
    const { deps, saved, added } = setup([note('n1')], { answer: 'throw' })
    await raiseHqNoteCards(deps)
    expect(saved.size).toBe(0)
    expect(added).toHaveLength(0)
  })

  it('asks about three lines a pass; the rest wait for the next', async () => {
    const lines = ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
      note(id, { createdAt: NOW - 100_000 + index })
    )
    const { deps, asked, added } = setup(lines)
    expect(await raiseHqNoteCards(deps)).toBe(3)
    expect(await raiseHqNoteCards(deps)).toBe(2)
    expect(await raiseHqNoteCards(deps)).toBe(0)
    expect(asked).toHaveLength(5)
    expect(added).toHaveLength(5)
  })

  it('makes no card for an agent reminder', async () => {
    const { deps, asked, added } = setup([note('n1', { source: 'agent' })])
    await raiseHqNoteCards(deps)
    expect(asked).toHaveLength(0)
    expect(added).toHaveLength(0)
  })

  it('closes the card of a line that is no longer open, and keeps the card of an open one', async () => {
    const lines = [note('n1'), note('n2')]
    const { deps, db, closed } = setup(lines)
    await raiseHqNoteCards(deps)
    lines[0] = note('n1', { status: 'resolved' })
    const route = vi.fn()
    await raiseHqNoteCards({ ...deps, route })
    const open = db.listInbox({ kind: HQ_INTAKE_KIND }).map((item) => item.dedupeKey)
    expect(open).toEqual(['router:note:n2'])
    expect(closed).toHaveLength(1)
    expect(route).not.toHaveBeenCalled()
  })

  it('a card closed for its line stays closed through the poll’s sync, which keeps `router:` cards', async () => {
    const lines = [note('n1')]
    const { deps, db } = setup(lines)
    await raiseHqNoteCards(deps)
    const [item] = db.listInbox({ kind: HQ_INTAKE_KIND })
    const kept = readHqIntake(item?.refId ?? null) as HqIntake
    lines[0] = note('n1', { status: 'resolved' })
    await raiseHqNoteCards(deps)
    // The poll lists every `router:` card of the week, open or done, as wanted.
    for (let poll = 0; poll < 3; poll += 1) {
      db.syncInboxKind(HQ_INTAKE_KIND, [
        { ...hqIntakeBellItem(kept), dedupeKey: hqIntakeKey(kept) }
      ])
      await raiseHqNoteCards(deps)
    }
    expect(db.listInbox({ kind: HQ_INTAKE_KIND })).toEqual([])
    expect(db.listInbox({ includeDone: true, kind: HQ_INTAKE_KIND })).toHaveLength(1)
  })

  it('a card the poll closed as gone while the line is open comes back once, with no call', async () => {
    const { deps, db, asked } = setup([note('n1')])
    await raiseHqNoteCards(deps)
    db.syncInboxKind(HQ_INTAKE_KIND, [])
    expect(db.listInbox({ kind: HQ_INTAKE_KIND })).toEqual([])
    await raiseHqNoteCards(deps)
    await raiseHqNoteCards(deps)
    expect(db.listInbox({ kind: HQ_INTAKE_KIND })).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('leaves the cards of other readers alone', async () => {
    const { deps, db, closed } = setup([])
    db.addInboxItem({ kind: HQ_INTAKE_KIND, title: 'x', dedupeKey: 'hq-intake:C1:1.1' })
    db.addInboxItem({ kind: HQ_INTAKE_KIND, title: 'y', dedupeKey: 'router:C1:2.2' })
    await raiseHqNoteCards(deps)
    expect(closed).toHaveLength(0)
  })
})

describe('hqNoteRaisedKeys', () => {
  it('counts open and owner-handled cards, not one the poll closed by itself', () => {
    const keys = hqNoteRaisedKeys([
      { dedupeKey: 'a', doneAt: null, doneAction: null },
      { dedupeKey: 'b', doneAt: 1, doneAction: 'skipped' },
      { dedupeKey: 'c', doneAt: 1, doneAction: INBOX_GONE_ACTION },
      { dedupeKey: null, doneAt: null, doneAction: null }
    ])
    expect([...keys]).toEqual(['a', 'b'])
  })
})
