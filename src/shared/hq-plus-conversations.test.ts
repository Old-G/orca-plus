import { describe, expect, it } from 'vitest'
import type { HqJournalEntry } from './hq-journal'
import type { PulseInboxItem } from './pulse-types'
import type { HqFeedResult } from './hq-plus-screen'
import { hqPlusFeedLog } from './hq-plus-conversations'
import { hqPlusLedgerOnly } from './hq-plus-ledger-cards'
import { hqPlusTranscript, type HqFeedLedger } from './hq-feed-ledger'
import { hqPlusIsFyi, hqPlusLook, hqPlusNeedsOwner } from './hq-plus-kinds'
import { hqPlusInFeedFilter } from './hq-plus-feed-filter'
import { hqPlusMapFeedPlace, hqPlusMapModel, hqPlusMapSourceOf } from './hq-plus-map'
import { HQ_PLUS_ANY_ROOM } from './hq-plus-log'

const NOW = Date.UTC(2026, 9, 30, 15)
const MIN = 60_000
const DAY_START = NOW - 12 * 60 * MIN
const THREAD = 'slack:C0HUB:1793000000.000100'

function row(over: Partial<HqJournalEntry>): HqJournalEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    at: NOW - 60 * MIN,
    workspace: 'acme',
    kind: 'waiting.open',
    project: 'hub',
    address: null,
    sessionId: null,
    personId: null,
    title: 'Waiting on Ann: mark 37 pairs',
    body: null,
    needs: 'person:ann',
    status: 'open',
    replyTo: null,
    refKind: 'waiting',
    refId: 'w-1',
    links: [],
    source: 'pulse',
    dedupeKey: null,
    ...over
  }
}

function bell(over: Partial<PulseInboxItem>): PulseInboxItem {
  return {
    id: `i-${Math.random().toString(36).slice(2)}`,
    kind: 'hq-waiting-reply',
    title: 'Ann replied',
    body: null,
    urgency: 'normal',
    refKind: 'waiting',
    refId: null,
    actions: [{ id: 'deliver', label: 'Send to chat' }],
    dedupeKey: null,
    createdAt: NOW - 20 * MIN,
    readAt: null,
    doneAt: null,
    doneAction: null,
    ...over
  }
}

const reply = bell({
  refId: JSON.stringify({
    waitingId: 'w-1',
    sessionId: 'chat-1',
    worktreeId: null,
    project: 'hub',
    question: 'Mark 37 pairs',
    askedAt: NOW - 60 * MIN,
    asked: 'Ann, can you mark the 37 pairs?',
    author: 'Ann',
    replyTs: '1793000009.0',
    reply: 'Done, 19 of 19',
    link: 'https://acme.slack.com/archives/C0HUB/p1793000009000000?thread_ts=1793000000.000100'
  })
})
const mention = bell({
  kind: 'hq-intake',
  title: 'Ann: page not found',
  createdAt: NOW - 10 * MIN,
  refId: JSON.stringify({
    channel: 'C0HUB',
    ts: '1793000000.000100',
    threadTs: '1793000000.000100',
    author: 'Ann',
    venue: 'channel',
    text: 'Ann: the page says not found',
    conversationId: 'c-1',
    at: NOW - 10 * MIN,
    summary: 'page not found'
  }),
  actions: [{ id: 'intake-open', label: 'To work' }]
})
const remind = bell({
  kind: 'hq-remind',
  title: 'No answer from Bob: review the MR',
  refId: 'w-2',
  createdAt: NOW - 5 * MIN,
  actions: [{ id: 'remind', label: 'Remind' }]
})

const ledger: HqFeedLedger = {
  conversations: [
    {
      id: 'c-1',
      key: THREAD,
      project: 'hub',
      projectHow: 'model',
      title: 'Ann marked the pairs and found a broken page',
      state: 'you',
      lastAt: NOW - 8 * MIN,
      sessionId: null,
      messages: [
        { direction: 'in', author: 'Ann', text: 'Done, 19 of 19', link: null, at: NOW - 21 * MIN },
        {
          direction: 'in',
          author: 'Ann',
          text: 'the page says not found',
          link: 'https://acme.slack.com/archives/C0HUB/p1',
          at: NOW - 8 * MIN
        }
      ]
    }
  ],
  waitingPlaces: { 'w-1': THREAD, 'w-2': 'gitlab:acme/hub!314' }
}

function feed(entries: HqJournalEntry[], inbox: PulseInboxItem[], withLedger = true): HqFeedResult {
  return { entries, sessions: [], inbox, now: NOW, ...(withLedger ? { ledger } : {}) }
}

describe('hqPlusFeedLog', () => {
  it('folds a thread’s answer, mention and waiting rows into one card at its newest message', () => {
    const waitingRow = row({})
    const answerRow = row({
      kind: 'person.reply',
      title: 'Ann: Done',
      at: NOW - 21 * MIN,
      needs: 'nobody'
    })
    const routed = row({
      kind: 'routing.action',
      refKind: 'waiting-reply',
      title: 'Ann answered — yours to reply in Slack',
      at: NOW - 20 * MIN,
      needs: 'nobody'
    })
    const items = hqPlusFeedLog(
      feed([waitingRow, answerRow, routed], [reply, mention, remind]),
      DAY_START,
      { chatQuestions: 'line' }
    )
    const cards = items.filter((item) => item.kind === 'card')
    // The MR's reminder has no conversation and stays a card of its own.
    expect(cards.map((card) => card.kind === 'card' && card.type)).toEqual(['conversation', 'bell'])
    const conversation = items.find((item) => item.id === `conv:${THREAD}`)
    expect(conversation).toMatchObject({
      at: NOW - 8 * MIN,
      project: 'hub',
      open: true,
      type: 'conversation'
    })
    if (conversation?.kind !== 'card' || !conversation.conversation) {
      throw new Error('no conversation card')
    }
    expect(conversation.conversation.guessed).toBe(true)
    expect(conversation.conversation.parts.map((part) => part.inbox?.kind)).toEqual([
      'hq-waiting-reply',
      'hq-intake'
    ])
    // The ledger saw the answer; the owner's question comes from the waiting.
    expect(conversation.conversation.messages.map((m) => m.direction)).toEqual(['out', 'in', 'in'])
    expect(conversation.inbox?.id).toBe(reply.id)
    expect(hqPlusNeedsOwner(conversation)).toBe(true)
    expect(hqPlusInFeedFilter(conversation, 'waits')).toBe(true)
    expect(hqPlusLook(conversation).badges.map((b) => b.label)).toEqual(['YOUR MOVE', 'SLACK'])
    // The waiting rows of the thread are in the card, not beside it.
    expect(items.some((item) => item.id === waitingRow.id || item.id === routed.id)).toBe(false)
  })

  it('keeps a lone reminder of a place with no conversation as it was', () => {
    const items = hqPlusFeedLog(feed([], [remind]), DAY_START)
    expect(items.map((item) => item.kind === 'card' && item.type)).toEqual(['bell'])
  })

  it('keeps the old feed when the host sends no ledger', () => {
    const items = hqPlusFeedLog(feed([row({})], [reply, mention], false), DAY_START)
    expect(items.some((item) => item.kind === 'card' && item.type === 'conversation')).toBe(false)
  })

  it('folds a settled conversation to a done card', () => {
    const decided = { ...reply, doneAt: NOW - 2 * MIN, doneAction: 'deliver' }
    const card = hqPlusFeedLog(feed([], [decided]), DAY_START).find((item) => item.kind === 'card')
    expect(card).toMatchObject({
      type: 'conversation',
      open: false,
      done: { by: 'action', action: 'deliver' }
    })
  })
})

describe('conversations no card stands for (hq-ledger-sources)', () => {
  const MR = 'gitlab:acme/app!7'
  const MAIL = 'gmail:t1'
  const conversation = (
    over: Partial<HqFeedLedger['conversations'][number]>
  ): HqFeedLedger['conversations'][number] => ({
    id: `c-${over.key ?? MR}`,
    key: MR,
    project: 'app',
    projectHow: 'rule',
    title: 'Review requested: Speed up the import',
    state: 'you',
    lastAt: NOW - 5 * MIN,
    sessionId: null,
    messages: [
      {
        direction: 'in',
        author: 'Ann',
        text: 'Speed up the import',
        link: 'https://gitlab.com/acme/app/-/merge_requests/7',
        at: NOW - 5 * MIN
      }
    ],
    ...over
  })
  const log = (conversations: HqFeedLedger['conversations']) =>
    hqPlusFeedLog(
      {
        entries: [],
        sessions: [],
        inbox: [],
        now: NOW,
        ledger: { conversations, waitingPlaces: {} }
      },
      DAY_START
    )

  it('shows an MR waiting on the owner as his move, however old, with its link', () => {
    const [card] = log([conversation({ lastAt: NOW - 9 * 24 * 60 * MIN })])
    if (card?.kind !== 'card') {
      throw new Error('no card')
    }
    expect(card).toMatchObject({
      id: `conv:${MR}`,
      type: 'conversation',
      room: HQ_PLUS_ANY_ROOM,
      project: 'app',
      open: true,
      inbox: null
    })
    expect(card.conversation).toMatchObject({
      ledgerState: 'you',
      parts: [],
      link: 'https://gitlab.com/acme/app/-/merge_requests/7'
    })
    expect(hqPlusLedgerOnly(card)).toBe(true)
    expect(hqPlusNeedsOwner(card)).toBe(true)
    expect(hqPlusLook(card).badges.map((b) => b.label)).toEqual(['YOUR MOVE', 'GITLAB'])
    expect(hqPlusInFeedFilter(card, 'move')).toBe(true)
    expect(hqPlusMapFeedPlace(card)).toBe('you')
    expect(hqPlusMapSourceOf(card)).toBe('gitlab')
  })

  it('shows a mail thread for information under the inbox, today’s only', () => {
    const items = log([
      conversation({ key: MAIL, state: 'fyi', title: 'Contract', project: null }),
      conversation({ key: 'gmail:t2', state: 'fyi', lastAt: DAY_START - MIN })
    ])
    expect(items.map((item) => item.id)).toEqual([`conv:${MAIL}`])
    const [card] = items
    if (card?.kind !== 'card') {
      throw new Error('no card')
    }
    expect(hqPlusIsFyi(card)).toBe(true)
    expect(hqPlusNeedsOwner(card)).toBe(false)
    expect(hqPlusLook(card).badges.map((b) => b.label)).toEqual(['GMAIL'])
    expect(hqPlusInFeedFilter(card, 'inbox')).toBe(true)
    expect(hqPlusMapFeedPlace(card)).toBe('fyi')
    const map = hqPlusMapModel({ projects: [], items, waits: [], chats: [] })
    expect(map.sources).toEqual([{ source: 'gmail', count: 1 }])
    expect(map.projects.map((project) => project.slug)).toEqual(['Unsorted'])
  })

  it('leaves done ones out, and Slack and ClickUp to their own cards', () => {
    const items = log([
      conversation({ state: 'done' }),
      conversation({ key: 'slack:C0HUB:1.2', state: 'you' }),
      conversation({ key: 'clickup:DEV-1', state: 'you' })
    ])
    expect(items).toEqual([])
  })

  it('folds an MR that has cards as before, with their buttons', () => {
    const items = hqPlusFeedLog(feed([], [remind]), DAY_START)
    const withLedger = hqPlusFeedLog(
      {
        ...feed([], [remind]),
        ledger: {
          conversations: [conversation({ key: 'gitlab:acme/hub!314' })],
          waitingPlaces: { 'w-2': 'gitlab:acme/hub!314' }
        }
      },
      DAY_START
    )
    expect(items.map((item) => item.kind === 'card' && item.type)).toEqual(['bell'])
    const [card] = withLedger
    expect(card?.kind === 'card' && card.conversation?.parts.length).toBe(1)
    expect(card && hqPlusLedgerOnly(card)).toBe(false)
  })
})

describe('hqPlusTranscript', () => {
  it('names the owner «You» and drops a repeated «Name:»', () => {
    expect(
      hqPlusTranscript([
        { direction: 'out', author: 'Owner', text: 'Ready?', link: null, at: 1 },
        { direction: 'in', author: 'Ann', text: 'Ann: yes,\n done', link: null, at: 2 }
      ])
    ).toBe('You: Ready?\nAnn: yes, done')
  })
})
