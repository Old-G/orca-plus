import { describe, expect, it } from 'vitest'
import type { HqJournalEntry } from './hq-journal'
import type { HqPlusCard, HqPlusLogItem } from './hq-plus-log'
import type { HqPlusMapWait } from './hq-plus-map'
import type { PulseInboxItem } from './pulse-types'
import {
  hqPlusProjectCardOf,
  hqPlusProjectChatSummary,
  hqPlusProjectFeed,
  hqPlusProjectWaitSummary,
  type HqPlusProjectInput
} from './hq-plus-project-cards'
import type { HqPlusProjectChatInput } from './hq-plus-project-lines'
import { hqPlusProjectToday } from './hq-plus-project-today'

const NOW = Date.UTC(2026, 9, 31, 15)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const SINCE = NOW - 12 * HOUR

function inbox(kind: string, refId: string | null = null): PulseInboxItem {
  return {
    id: `i-${kind}-${Math.random().toString(36).slice(2)}`,
    kind,
    title: 'Ann: look at the diff',
    body: null,
    urgency: 'normal',
    refKind: null,
    refId,
    actions: [],
    dedupeKey: null,
    createdAt: NOW,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
}

function card(over: Partial<HqPlusCard> & { id: string }): HqPlusCard {
  return {
    kind: 'card',
    at: NOW - HOUR,
    room: 'work',
    project: 'acme-api',
    address: null,
    sessionId: null,
    type: 'bell',
    title: 'Something',
    body: null,
    report: null,
    open: true,
    done: null,
    entry: null,
    inbox: null,
    ...over
  }
}

/** A Slack thread that waits on the owner: Ann's mention folded in. */
function thread(
  id: string,
  project: string | null,
  over: { at?: number; since?: number; author?: string; title?: string } = {}
): HqPlusCard {
  const since = over.since ?? NOW - HOUR
  const part = card({
    id: `${id}-part`,
    at: since,
    project,
    inbox: inbox('slack-request', JSON.stringify({ id: 'C1:1.2', kind: 'answer' }))
  })
  return card({
    id,
    at: over.at ?? since,
    project,
    type: 'conversation',
    conversation: {
      key: `slack:C1:${id}`,
      title: over.title ?? 'Merge the duplicate tickets of one customer',
      guessed: false,
      messages: [
        {
          direction: 'in',
          author: over.author ?? 'Ann',
          text: 'can you merge them?',
          link: null,
          at: since
        }
      ],
      parts: [part],
      link: null
    }
  })
}

function fyiThread(id: string, project: string | null, at: number): HqPlusCard {
  return card({
    id,
    at,
    project,
    type: 'conversation',
    conversation: {
      key: `gitlab:acme/api!${id}`,
      title: 'Pipeline passed on !4',
      guessed: false,
      messages: [],
      parts: [],
      link: null,
      ledgerState: 'fyi'
    }
  })
}

function chatLine(sessionId: string, project: string, at: number): HqPlusLogItem {
  return {
    kind: 'line',
    id: `line-${sessionId}-${at}`,
    at,
    room: 'work',
    project,
    address: null,
    sessionId,
    tone: 'agent',
    title: 'Done: the table is in main',
    journalKind: 'chat.report'
  }
}

function wait(over: Partial<HqPlusMapWait> & { id: string }): HqPlusMapWait {
  return {
    personName: 'Bob',
    project: 'acme-api',
    title: 'Review the MR',
    at: NOW - 2 * DAY,
    answerId: null,
    ...over
  }
}

function chat(over: Partial<HqPlusProjectChatInput> & { key: string }): HqPlusProjectChatInput {
  return {
    project: 'acme-api',
    state: 'working',
    sessionId: null,
    title: 'Fix the table',
    at: NOW - 30 * MIN,
    ...over
  }
}

function entry(over: Partial<HqJournalEntry>): HqJournalEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    at: NOW - HOUR,
    workspace: 'work',
    kind: 'approve.result',
    project: 'acme-api',
    address: null,
    sessionId: 'chat-1',
    personId: null,
    title: 'Approved → DM Ann: Slack · send message',
    body: 'Ann, the table is in main.\nDetails below.',
    needs: 'nobody',
    status: 'done',
    replyTo: null,
    refKind: 'decision',
    refId: 'd-1',
    links: [],
    source: 'approve-gate',
    dedupeKey: null,
    ...over
  }
}

function input(over: Partial<HqPlusProjectInput>): HqPlusProjectInput {
  return { items: [], waits: [], chats: [], entries: [], since: SINCE, ...over }
}

describe('hqPlusProjectFeed — one card per project', () => {
  it('puts each conversation under its project; HQ keeps its own rows, outside talks with no project go to Unsorted', () => {
    const feed = hqPlusProjectFeed({
      ...input({
        items: [
          thread('t1', 'acme-api'),
          thread('t2', 'acme-api', { author: 'Bob' }),
          thread('t3', null),
          card({ id: 'report', project: null, type: 'report', title: 'Day review' })
        ]
      }),
      filter: 'all'
    })
    const bySlug = new Map(feed.cards.map((entry) => [entry.slug, entry]))
    expect(bySlug.get('acme-api')?.you.map((line) => line.id)).toEqual(['t1', 't2'])
    expect(bySlug.get('acme-api')?.you[1]).toMatchObject({
      who: 'Bob',
      what: 'Merge the duplicate tickets of one customer',
      badge: { label: 'SLACK' }
    })
    expect(bySlug.get('HQ')?.you.map((line) => line.id)).toEqual(['report'])
    expect(
      hqPlusProjectFeed({
        ...input({ items: [thread('t4', 'acme-api', { title: 'Ann: can you merge?' })] }),
        filter: 'all'
      }).cards[0].you[0]
    ).toMatchObject({ who: 'Ann', what: 'can you merge?' })
    expect(bySlug.get('Unsorted')).toMatchObject({ unsorted: true })
    expect(feed.cards.at(-1)?.slug).toBe('Unsorted')
    expect(feed.counts.move).toBe(4)
  })

  it('reads as a chat: the project something last came to is at the bottom, quiet waits on top', () => {
    const feed = hqPlusProjectFeed({
      ...input({
        items: [
          thread('fresh', 'acme-web', { since: NOW - HOUR }),
          thread('old', 'acme-api', { since: NOW - 3 * DAY }),
          chatLine('chat-2', 'acme-ops', NOW - 5 * MIN)
        ],
        waits: [
          wait({ id: 'w1', project: 'acme-db', at: NOW - DAY }),
          wait({ id: 'w2', project: 'acme-mail', at: NOW - 4 * DAY })
        ],
        chats: [chat({ key: 'k2', project: 'acme-ops', sessionId: 'chat-2' })],
        entries: [entry({ project: 'acme-docs', at: NOW - 3 * HOUR })]
      }),
      filter: 'all'
    })
    expect(feed.cards.map((entry) => entry.slug)).toEqual([
      'acme-db',
      'acme-mail',
      'acme-api',
      'acme-docs',
      'acme-web',
      'acme-ops'
    ])
    expect(feed.cards.find((entry) => entry.slug === 'acme-db')?.compact).toBe(true)
    expect(feed.cards.find((entry) => entry.slug === 'acme-ops')?.compact).toBe(false)
  })

  it('a new message keeps the line in place and moves its card to the bottom', () => {
    const before = hqPlusProjectFeed({
      ...input({
        items: [thread('a', 'acme-api', { since: NOW - 2 * HOUR })],
        waits: [wait({ id: 'w1', project: 'acme-web' })]
      }),
      filter: 'all'
    })
    expect(before.cards.map((entry) => entry.slug)).toEqual(['acme-web', 'acme-api'])
    const after = hqPlusProjectFeed({
      ...input({
        items: [
          thread('a', 'acme-api', { since: NOW - 2 * HOUR, at: NOW - MIN }),
          thread('b', 'acme-web', { since: NOW - 3 * HOUR })
        ],
        waits: [wait({ id: 'w1', project: 'acme-web' })]
      }),
      filter: 'all'
    })
    expect(after.cards.map((entry) => entry.slug)).toEqual(['acme-web', 'acme-api'])
    expect(after.cards[1].you.map((line) => [line.id, line.at])).toEqual([['a', NOW - MIN]])
  })

  it('an answered waiting is a green line under «Your move», not a wait', () => {
    const answer = card({
      id: 'answer',
      type: 'reply',
      inbox: inbox(
        'hq-waiting-reply',
        JSON.stringify({
          waitingId: 'w1',
          sessionId: 'chat-1',
          worktreeId: null,
          project: 'acme-api',
          question: 'Mark 37 pairs',
          askedAt: NOW - DAY,
          author: 'Ann',
          replyTs: '1.0',
          reply: 'Done, 19 of 19',
          link: null
        })
      )
    })
    const [only] = hqPlusProjectFeed({
      ...input({
        items: [answer],
        waits: [
          wait({ id: 'w1', personName: 'Ann', answerId: 'answer' }),
          wait({ id: 'w2', personName: 'Bob' })
        ]
      }),
      filter: 'all'
    }).cards
    expect(only.you[0]).toMatchObject({ replied: true, who: 'Ann', what: 'Mark 37 pairs' })
    expect(only.persons.map((person) => person.name)).toEqual(['Bob'])
    expect(only.waits).toBe(1)
  })
})

describe('hqPlusProjectFeed — the chips', () => {
  const items = [
    thread('t1', 'acme-api'),
    fyiThread('f1', 'acme-api', NOW - 2 * HOUR),
    fyiThread('f2', 'acme-web', NOW - HOUR)
  ]
  const waits = [wait({ id: 'w1', project: 'acme-db' })]
  const chats = [chat({ key: 'k1', project: 'acme-api' })]
  const entries = [entry({ project: 'acme-api' })]

  it('All: FYI folds into one row; a project with only FYI is no card', () => {
    const feed = hqPlusProjectFeed({ ...input({ items, waits, chats, entries }), filter: 'all' })
    expect(feed.cards.map((entry) => entry.slug)).toEqual(['acme-db', 'acme-api'])
    expect(feed.cards[1].shown).toEqual({
      approve: true,
      you: true,
      fyi: false,
      wait: true,
      today: true,
      chats: true
    })
    expect(feed.fyi.map((row) => [row.slug, row.count])).toEqual([
      ['acme-web', 1],
      ['acme-api', 1]
    ])
    expect(feed.counts).toEqual({ approve: 0, asks: 0, move: 1, wait: 1, fyi: 2 })
  })

  it('Your move shows only the lines on the owner', () => {
    const feed = hqPlusProjectFeed({ ...input({ items, waits, chats, entries }), filter: 'move' })
    expect(feed.cards.map((entry) => entry.slug)).toEqual(['acme-api'])
    expect(feed.cards[0].shown).toMatchObject({
      you: true,
      wait: false,
      today: false,
      chats: false
    })
  })

  it('We wait opens every card to its people, a one-line card too', () => {
    const feed = hqPlusProjectFeed({ ...input({ items, waits, chats, entries }), filter: 'wait' })
    expect(feed.cards.map((entry) => [entry.slug, entry.compact])).toEqual([['acme-db', false]])
    expect(feed.cards[0].shown).toMatchObject({ you: false, wait: true })
  })

  it('FYI shows the FYI lines, newest project last', () => {
    const feed = hqPlusProjectFeed({ ...input({ items, waits, chats, entries }), filter: 'fyi' })
    expect(feed.cards.map((entry) => entry.slug)).toEqual(['acme-api', 'acme-web'])
    expect(feed.cards[0].shown).toMatchObject({ you: false, fyi: true })
  })

  it('⌘F keeps the lines it found; a card whose name matches keeps all', () => {
    const search = (query: string) =>
      hqPlusProjectFeed({
        ...input({ items: [thread('t1', 'acme-api'), thread('t2', 'acme-web')] }),
        filter: 'all',
        search: { query, matches: (item) => item.id === 't2' }
      }).cards.map((entry) => [entry.slug, entry.you.map((line) => line.id)])
    expect(search('tickets')).toEqual([['acme-web', ['t2']]])
    expect(search('api')).toEqual([
      ['acme-api', ['t1']],
      ['acme-web', ['t2']]
    ])
  })
})

describe('hqPlusProjectFeed — review fixes', () => {
  it('FYI opens a project that has only FYI, never as a «We wait · 0» line', () => {
    const feed = hqPlusProjectFeed({
      ...input({ items: [fyiThread('f1', 'acme-web', NOW - HOUR)] }),
      filter: 'fyi'
    })
    expect(feed.cards.map((entry) => [entry.slug, entry.compact])).toEqual([['acme-web', false]])
  })

  it('⌘F keeps a project whose chat said the words', () => {
    const feed = hqPlusProjectFeed({
      ...input({
        items: [thread('t1', 'acme-api'), chatLine('s1', 'acme-api', NOW - MIN)],
        chats: [chat({ key: 'k1', sessionId: 's1', state: 'done' })]
      }),
      filter: 'all',
      search: { query: 'widget', matches: (item) => item.id.startsWith('line-s1') }
    })
    expect(feed.cards.map((entry) => [entry.slug, entry.chatHits])).toEqual([['acme-api', ['k1']]])
  })
})

describe('hqPlusProjectToday — what was done today', () => {
  it('a sent message names where it went and its first line', () => {
    expect(hqPlusProjectToday(entry({}))).toMatchObject({
      kind: 'sent',
      to: 'DM Ann',
      text: 'Ann, the table is in main.',
      sessionId: 'chat-1'
    })
  })

  it('a task name with colons stays whole', () => {
    expect(
      hqPlusProjectToday(
        entry({ title: 'Approved → [api] Release 1.2: notes for Bob: ClickUp · comment' })
      )
    ).toMatchObject({ kind: 'sent', to: '[api] Release 1.2: notes for Bob' })
  })

  it('deletes and pushes say what the gate saw', () => {
    expect(
      hqPlusProjectToday(
        entry({
          title: 'Approved: GitLab · glab api delete',
          body: 'glab api -X DELETE projects/acme%2Fapi/repository/branches/old'
        })
      )
    ).toMatchObject({ kind: 'deleted', to: 'GitLab · glab api delete' })
    expect(
      hqPlusProjectToday(entry({ title: 'Approved → [api] fix: git · force or delete push' }))
    ).toMatchObject({ kind: 'pushed' })
  })

  it('a rejected message did nothing', () => {
    expect(hqPlusProjectToday(entry({ title: 'Rejected → DM Ann: Slack · send message' }))).toBe(
      null
    )
  })

  it('a chat that shipped or merged says so; «not shipped» is not a release', () => {
    const report = (title: string) =>
      hqPlusProjectToday(entry({ kind: 'chat.report', title, body: null }))?.kind ?? null
    expect(report('Выкачено и проверено: Acme 1.2 на сервере')).toBe('shipped')
    expect(report('Фикс выкачен и проверен')).toBe('shipped')
    expect(report('MR !18 влит в main, но на сервер не выкачен')).toBe('merged')
    expect(report('Доработка влита в main. На сервере ещё не выкачено')).toBe('merged')
    expect(report('Сделал макет, ничего не выкачено')).toBe(null)
    expect(report('Ветка создана от custom, где стоит выкаченная сборка')).toBe(null)
    expect(report('Shipped 1.2 to production')).toBe('shipped')
    expect(report('Not merged yet, waiting for review')).toBe(null)
    expect(report('Ready to be merged after review')).toBe(null)
    expect(report('Will be deployed after approval')).toBe(null)
    expect(report('Ветка будет влита после ревью')).toBe(null)
  })

  it('only today, newest first, under the row’s project', () => {
    const [only] = hqPlusProjectFeed({
      ...input({
        entries: [
          entry({ id: 'old', at: SINCE - HOUR }),
          entry({ id: 'a', at: NOW - 3 * HOUR }),
          entry({ id: 'b', at: NOW - HOUR, kind: 'chat.report', title: 'Shipped 1.2', body: null })
        ]
      }),
      filter: 'all'
    }).cards
    expect(only.slug).toBe('acme-api')
    expect(only.today.map((row) => [row.id, row.kind])).toEqual([
      ['b', 'shipped'],
      ['a', 'sent']
    ])
  })
})

describe('hqPlusProjectFeed — chats', () => {
  it('lists the project’s open chats, the one asking first, each with its newest turn', () => {
    const [only] = hqPlusProjectFeed({
      ...input({
        items: [chatLine('s1', 'acme-api', NOW - HOUR), chatLine('s1', 'acme-api', NOW - MIN)],
        chats: [
          chat({ key: 'k1', sessionId: 's1', state: 'done' }),
          chat({ key: 'k2', sessionId: 's2', state: 'asks' }),
          chat({ key: 'k3', sessionId: null, state: 'quiet' })
        ]
      }),
      filter: 'all'
    }).cards
    expect(only.chats.map((entry) => [entry.key, entry.line?.at ?? null])).toEqual([
      ['k2', null],
      ['k1', NOW - MIN],
      ['k3', null]
    ])
    expect(hqPlusProjectChatSummary(only.chats)).toBe('1 asks you · 1 done · 1 quiet')
  })

  it('a read chat keeps its project in the feed, as the chat list keeps it (owner, 01.11: 3A)', () => {
    const quiet = input({ chats: [chat({ key: 'k1', state: 'quiet' })] })
    expect(hqPlusProjectFeed({ ...quiet, filter: 'all' }).cards.map((c) => c.slug)).toEqual([
      'acme-api'
    ])
    expect(hqPlusProjectCardOf(quiet, 'acme-api')).toMatchObject({
      slug: 'acme-api',
      compact: false,
      shown: { approve: true, you: true, fyi: true, wait: true, today: true, chats: true }
    })
    expect(hqPlusProjectCardOf(quiet, 'acme-api').chats.map((entry) => entry.key)).toEqual(['k1'])
    expect(hqPlusProjectCardOf(quiet, 'acme-none').you).toEqual([])
  })
})

describe('hqPlusProjectFeed — Approve and chats first (hq-card-v2)', () => {
  const approve = card({
    id: 'ap1',
    type: 'approve',
    title: 'Approve: Slack · send message',
    at: NOW - 5 * MIN
  })
  const question = card({
    id: 'q1',
    type: 'move',
    sessionId: 's1',
    title: 'Ship it now or tonight?',
    at: NOW - 20 * MIN
  })
  const both = input({
    items: [approve, question, thread('t1', 'acme-api')],
    chats: [chat({ key: 'k1', sessionId: 's1', state: 'done' })]
  })

  it('an action waiting for Approve is its own section, not a «Your move» line', () => {
    const [only] = hqPlusProjectFeed({ ...both, filter: 'all' }).cards
    expect(only.approve.map((line) => line.id)).toEqual(['ap1'])
    expect(only.you.map((line) => line.id)).toEqual(['t1'])
  })

  it('a chat’s question stands on its chat, not among the people’s lines', () => {
    const [only] = hqPlusProjectFeed({ ...both, filter: 'all' }).cards
    expect(only.chats[0]?.question?.id).toBe('q1')
    // Why: a question whose chat is not open stays a line, so it is never lost.
    const orphan = hqPlusProjectFeed({ ...input({ items: [question] }), filter: 'all' }).cards
    expect(orphan[0]?.you.map((line) => line.id)).toEqual(['q1'])
  })

  it('the Approve and Chats chips keep the cards that have them; the counts say how many', () => {
    const feed = hqPlusProjectFeed({ ...both, filter: 'approve' })
    expect(feed.counts).toMatchObject({ approve: 1, asks: 1, move: 1 })
    expect(feed.cards[0]?.shown).toMatchObject({ approve: true, chats: false, you: false })
    const chats = hqPlusProjectFeed({
      ...input({ chats: [chat({ key: 'k9', project: 'acme-web' })] }),
      filter: 'chats'
    })
    expect(chats.cards.map((c) => [c.slug, c.shown.chats, c.shown.approve])).toEqual([
      ['acme-web', true, false]
    ])
    expect(hqPlusProjectFeed({ ...input({}), filter: 'approve' }).cards).toEqual([])
  })
})

describe('hqPlusProjectWaitSummary', () => {
  it('names whom we wait for and the oldest wait', () => {
    const [only] = hqPlusProjectFeed({
      ...input({
        waits: [
          wait({ id: 'w1', personName: 'Ann', at: NOW - 4 * DAY }),
          wait({ id: 'w2', personName: 'Ann', at: NOW - DAY }),
          wait({ id: 'w3', personName: 'Bob', at: NOW - 2 * HOUR })
        ]
      }),
      filter: 'all'
    }).cards
    expect(hqPlusProjectWaitSummary(only, NOW)).toBe('Ann 2 · Bob 1 — oldest 4 d')
  })
})
