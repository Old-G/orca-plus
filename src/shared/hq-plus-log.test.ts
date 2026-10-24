import { describe, expect, it } from 'vitest'
import type { HqJournalEntry } from './hq-journal'
import type { PulseInboxItem } from './pulse-types'
import { hqPlusGraph, hqPlusLanes } from './hq-plus-river-graph'
import { hqPlusAsksOwner, hqPlusChoices, hqPlusLog, hqPlusWaiting } from './hq-plus-log'
import { parseHqPlusReport, summarizeHqPlusReport } from './hq-plus-screen'
import { hqPlusFoldChats, hqPlusLiftActiveChats, hqPlusWithLiveChats } from './hq-plus-fold'
import {
  hqPlusInFeedFilter,
  hqPlusMatchesSearch,
  type HqPlusFeedFilter
} from './hq-plus-feed-filter'
import { hqPlusDaysAgo, hqPlusSameDay } from './hq-plus-feed-days'

const NOW = Date.UTC(2026, 9, 23, 12)
const HOUR = 60 * 60_000

function row(over: Partial<HqJournalEntry>): HqJournalEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    at: NOW - HOUR,
    workspace: 'acme',
    kind: 'chat.report',
    project: 'kite',
    address: null,
    sessionId: null,
    personId: null,
    title: 'something',
    body: null,
    needs: 'nobody',
    status: 'done',
    replyTo: null,
    refKind: null,
    refId: null,
    links: [],
    source: 'chat-report',
    dedupeKey: null,
    ...over
  }
}

function bell(over: Partial<PulseInboxItem>): PulseInboxItem {
  return {
    id: `i-${Math.random().toString(36).slice(2)}`,
    kind: 'agent-finished',
    title: 'An agent finished',
    body: null,
    urgency: 'normal',
    refKind: null,
    refId: null,
    actions: [],
    dedupeKey: null,
    createdAt: NOW - HOUR,
    readAt: null,
    doneAt: null,
    doneAction: null,
    ...over
  }
}

const DAY_START = NOW - 12 * HOUR

describe('parseHqPlusReport', () => {
  it('reads the three fields and the options of a turn report', () => {
    expect(
      parseHqPlusReport('Done: login works\nQuestion: ship now? (options: yes | later)\nNext: docs')
    ).toEqual({
      done: 'login works',
      ask: 'ship now?',
      options: ['yes', 'later'],
      next: 'docs',
      waitingOn: null
    })
  })

  it('is null for a body that is not a report', () => {
    expect(parseHqPlusReport('a waiting about Ann')).toBeNull()
  })
})

describe('hqPlusLog', () => {
  it('keeps the day in order and turns a turn that ends on a question into an open card', () => {
    const asked = bell({ id: 'i1' })
    const log = hqPlusLog(
      [
        row({ id: 'a', at: NOW - 3 * HOUR, title: 'kite: login works' }),
        row({
          id: 'b',
          at: NOW - 2 * HOUR,
          body: 'Ready. Ship it now?',
          refKind: 'inbox',
          refId: 'i1'
        })
      ],
      [asked],
      DAY_START
    )
    expect(log.map((item) => item.kind)).toEqual(['line', 'card'])
    expect(hqPlusWaiting(log).map((item) => item.id)).toEqual(['b'])
  })

  it('keeps a decided card in place, closed by the owner reply', () => {
    const log = hqPlusLog(
      [
        row({ id: 'q', at: NOW - 2 * HOUR, body: 'Ship it now?', refKind: 'inbox', refId: 'i1' }),
        row({
          id: 'r',
          at: NOW - HOUR,
          kind: 'chat.message',
          title: 'From HQ+: yes',
          body: '> Ship it now?\n\nyes',
          replyTo: 'q',
          source: 'chat-send'
        })
      ],
      [bell({ id: 'i1' })],
      DAY_START
    )
    const card = log.find((item) => item.id === 'q')
    expect(card).toMatchObject({ kind: 'card', open: false, done: { by: 'reply', text: 'yes' } })
    expect(log.at(-1)).toMatchObject({ kind: 'me', text: 'yes' })
  })

  it("keeps an agent's own draft open for the owner though no bell card stands for it", () => {
    const draft = (status: 'open' | 'done') =>
      hqPlusLog(
        [
          row({
            id: 'h',
            kind: 'approve.request',
            needs: 'owner:approve',
            status,
            refKind: 'draft',
            refId: 'd9'
          })
        ],
        [],
        DAY_START
      )[0]
    expect(draft('open')).toMatchObject({ kind: 'card', type: 'approve', open: true, done: null })
    expect(draft('done')).toMatchObject({ kind: 'card', type: 'approve', open: false })
  })

  it('folds held messages, answers and reports from the bell where they arrived', () => {
    const log = hqPlusLog(
      [
        row({
          id: 'h',
          kind: 'approve.request',
          needs: 'owner:approve',
          status: 'open',
          refKind: 'draft',
          refId: 'd1'
        })
      ],
      [
        bell({ id: 'ap', kind: 'outgoing-approval', refId: 'd1' }),
        bell({
          id: 'rp',
          kind: 'hq-report',
          refId: 'daily/2026-10-23.md',
          createdAt: NOW - 30 * 60_000
        }),
        bell({ id: 'old', kind: 'hq-report', createdAt: NOW - 30 * HOUR, doneAt: NOW - 29 * HOUR })
      ],
      DAY_START
    )
    expect(log.map((item) => (item.kind === 'card' ? item.type : item.kind))).toEqual([
      'approve',
      'report'
    ])
    expect(hqPlusWaiting(log)).toHaveLength(2)
  })

  it('keeps what waits on the owner from before today, drops the rest', () => {
    const log = hqPlusLog(
      [
        row({
          id: 'w',
          at: NOW - 40 * HOUR,
          kind: 'waiting.open',
          needs: 'owner:reply',
          status: 'open'
        }),
        row({ id: 'x', at: NOW - 40 * HOUR, title: 'yesterday' })
      ],
      [],
      DAY_START
    )
    expect(log.map((item) => item.id)).toEqual(['w'])
  })

  it('asks the owner only when the turn ends on a question', () => {
    expect(hqPlusAsksOwner('Done. Which one: A or B?')).toBe(true)
    expect(hqPlusAsksOwner('Is it fine? I checked, it is. Shipped.')).toBe(false)
  })
})

describe('hqPlusLanes', () => {
  it('draws work as merged segments and the oldest wait to now', () => {
    const lanes = hqPlusLanes(
      [
        { project: 'kite', workspace: 'acme', at: NOW - HOUR, sessionId: null },
        { project: 'kite', workspace: 'acme', at: NOW - 2 * HOUR, sessionId: null },
        { project: 'mill', workspace: 'acme', at: NOW - 6 * 24 * HOUR, sessionId: null }
      ],
      [
        {
          personId: 'p1',
          personName: 'Ann',
          project: 'kite',
          title: 'keys',
          createdAt: NOW - 3 * 24 * HOUR,
          direction: 'on-them'
        }
      ],
      NOW
    )
    expect(lanes[0]).toMatchObject({
      project: 'kite',
      note: { kind: 'wait', person: 'Ann', days: 3, long: true }
    })
    expect(lanes[0].work).toHaveLength(1)
    expect(lanes[1]).toMatchObject({ project: 'mill', note: { kind: 'quiet', days: 6 } })
  })
})

describe('hqPlusGraph', () => {
  it('links people to the projects they hold up and projects to what they lean on', () => {
    const graph = hqPlusGraph({
      waits: [
        {
          personId: 'p1',
          personName: 'Ann',
          project: 'kite',
          title: 't',
          createdAt: NOW - 3 * 24 * HOUR,
          direction: 'on-them'
        },
        {
          personId: 'p2',
          personName: 'Bob',
          project: null,
          title: 't',
          createdAt: NOW - HOUR,
          direction: 'on-me'
        }
      ],
      pages: [
        { slug: 'kite', room: 'acme', relations: ['api', 'mill'] },
        { slug: 'mill', room: 'acme', relations: [] }
      ],
      active: new Set(['mill']),
      now: NOW
    })
    expect(graph.projects.map((node) => node.id)).toEqual(['kite', 'mill'])
    expect(graph.systems.map((node) => node.id)).toEqual(['api'])
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'p1', to: 'kite', kind: 'wait-long' },
        { from: 'kite', to: 'mill', kind: 'relation' },
        { from: 'kite', to: 'api', kind: 'relation' },
        { from: 'owner', to: 'p2', kind: 'owe' }
      ])
    )
    expect(graph.people.map((node) => node.id)).toEqual(['p1', 'p2', 'owner'])
  })

  it('keeps a one-way relation whatever the slug order, and draws a mutual one once', () => {
    const graph = hqPlusGraph({
      waits: [],
      pages: [
        { slug: 'zeta', room: 'acme', relations: ['alpha', 'mill'] },
        { slug: 'alpha', room: 'acme', relations: [] },
        { slug: 'mill', room: 'acme', relations: ['zeta'] }
      ],
      active: new Set(['zeta', 'alpha', 'mill']),
      now: NOW
    })
    expect(graph.edges.filter((edge) => edge.kind === 'relation')).toEqual([
      { from: 'zeta', to: 'alpha', kind: 'relation' },
      { from: 'zeta', to: 'mill', kind: 'relation' }
    ])
  })
})

describe('hqPlusChoices', () => {
  it("turns a turn's lettered options into short labels", () => {
    expect(
      hqPlusChoices(
        'Как дальше?\n- **(а) Рекомендую:** ship it today after the check\n- (б) wait for Bob'
      )
    ).toEqual(['(а) Рекомендую: ship it today after…', '(б) wait for Bob'])
    expect(hqPlusChoices('Какой цвет взять: (а) синий или (б) зелёный?')).toEqual([
      '(а) синий',
      '(б) зелёный'
    ])
  })
})

describe('summarizeHqPlusReport', () => {
  it('counts serious Codex findings by project', () => {
    const summary = summarizeHqPlusReport(
      '# Codex — 22.10\n\n## kite · коммитов: 3\n\n- **[P1] Keep the lock** — `a.ts:1`\n- **[P2] Tidy** — `b.ts:2`\n',
      'updates/codex-review-2026-10-22T18-50.md'
    )
    expect(summary).toMatchObject({
      title: 'Codex — 22.10',
      rows: ['kite: Keep the lock'],
      codex: { serious: 1, minor: 1 }
    })
  })

  it('numbers the proposals to decide', () => {
    const summary = summarizeHqPlusReport(
      '# Day\n\n## Решить\n\n| № | Что |\n|---|---|\n| 1 | add a rule |\n| 2 | drop a card |\n\n## Сделаю сам\n\n| 3 | fix collect |\n',
      'daily/2026-10-22.md'
    )
    expect(summary.proposals).toEqual([1, 2])
    expect(summary.rows[0]).toBe('1 — add a rule')
  })
})

describe('report series', () => {
  it('keeps only the newest unanswered report of a series waiting', () => {
    const report = (refId: string, createdAt: number) =>
      bell({ kind: 'hq-report', title: 'A new report in HQ', body: refId, refId, createdAt })
    const log = hqPlusLog(
      [],
      [
        report('updates/codex-review-2026-10-22T18-50.md', NOW - HOUR),
        report('updates/codex-review-2026-10-21T19-14.md', NOW - 2 * HOUR),
        report('updates/codex-review-2026-10-20T19-28.md', NOW - 30 * HOUR),
        report('daily/2026-10-22.md', NOW - 3 * HOUR)
      ],
      NOW - 12 * HOUR
    )
    expect(hqPlusWaiting(log).map((card) => card.title)).toEqual([
      'daily/2026-10-22.md',
      'updates/codex-review-2026-10-22T18-50.md'
    ])
    expect(log).toHaveLength(3)
  })
})

describe('decided before the day', () => {
  it('keeps a wait raised yesterday and closed today, folded', () => {
    const log = hqPlusLog(
      [
        row({
          id: 'w',
          at: NOW - 30 * HOUR,
          kind: 'waiting.open',
          needs: 'owner:reply',
          status: 'done',
          refKind: 'waiting',
          refId: 'w1'
        }),
        row({ at: NOW - HOUR, kind: 'waiting.done', refKind: 'waiting', refId: 'w1' })
      ],
      [],
      NOW - 12 * HOUR
    )
    expect(log.find((item) => item.id === 'w')).toMatchObject({ kind: 'card', open: false })
  })
})

describe('a question the owner answered', () => {
  const answered = (askedAt: number) =>
    hqPlusLog(
      [
        row({
          id: 'q',
          at: askedAt,
          title: 'Limits read — Cap per order or per day?',
          body: 'Done: Limits read\nQuestion: Cap per order or per day? (options: order | day)',
          needs: 'owner:decide',
          status: 'done'
        }),
        row({
          id: 'r',
          at: NOW - HOUR,
          kind: 'chat.message',
          title: 'From HQ+: order',
          body: '> Limits read — Cap per order or per day?\n\norder',
          replyTo: 'q',
          source: 'chat-send'
        })
      ],
      [],
      NOW - 12 * HOUR
    ).find((item) => item.id === 'q')

  it('stays a folded card once its row is settled', () => {
    expect(answered(NOW - 2 * HOUR)).toMatchObject({
      kind: 'card',
      open: false,
      done: { by: 'reply', text: 'order' }
    })
  })

  it('keeps its card when it was asked before the day', () => {
    expect(answered(NOW - 30 * HOUR)).toMatchObject({ kind: 'card', open: false })
  })

  it('stays open when another chat, not the owner, replied', () => {
    const log = hqPlusLog(
      [
        row({ id: 'q', title: 'Ship behind a flag?', needs: 'owner:decide', status: 'open' }),
        row({
          at: NOW - HOUR / 2,
          kind: 'chat.message',
          title: 'From acme-api/refund-limits: API side is ready.',
          replyTo: 'q',
          source: 'chat-send'
        })
      ],
      [],
      DAY_START
    )
    expect(log.find((item) => item.id === 'q')).toMatchObject({ kind: 'card', open: true })
  })
})

describe('a report decided today', () => {
  it('keeps its folded card though it came yesterday', () => {
    const log = hqPlusLog(
      [],
      [
        bell({
          kind: 'hq-report',
          body: 'daily/2026-10-22.md',
          refId: 'daily/2026-10-22.md',
          createdAt: NOW - 30 * HOUR,
          doneAt: NOW - HOUR,
          doneAction: 'review'
        })
      ],
      NOW - 12 * HOUR
    )
    expect(log).toMatchObject([{ kind: 'card', type: 'report', open: false }])
  })
})

describe('bell items in the feed', () => {
  it('turns a former popup into a card and places a finished turn by its chat', () => {
    const finished = bell({
      kind: 'agent-finished',
      body: 'Claude · kite / main · Pick one: (a) red or (b) blue?',
      refId: JSON.stringify({
        paneKey: 'p',
        tabId: 'structured-agent-session-claude_s1',
        worktreeId: 'w1',
        place: 'kite / main',
        said: 'Pick one: (a) red or (b) blue?'
      })
    })
    const limit = bell({ kind: 'claude-chat-limit', title: 'A chat hit its limit' })
    const log = hqPlusLog([], [finished, limit], NOW - 12 * HOUR)
    expect(log.find((item) => item.kind === 'card' && item.type === 'move')).toMatchObject({
      project: 'kite',
      sessionId: 'claude_s1'
    })
    expect(log.find((item) => item.kind === 'card' && item.type === 'bell')).toMatchObject({
      open: true,
      title: 'A chat hit its limit'
    })
  })
})

describe('hqPlusFoldChats', () => {
  it('shows one row per chat with its earlier turns, and leaves the journal rows as they were', () => {
    const turns = [
      row({ sessionId: 's1', at: NOW - 3 * HOUR, title: 'Took it' }),
      row({ sessionId: 's2', at: NOW - 2.5 * HOUR, title: 'Other chat' }),
      row({ sessionId: 's1', at: NOW - 2 * HOUR, title: 'Did X' }),
      row({ sessionId: 's1', at: NOW - HOUR, title: 'All done' })
    ]
    const approve = row({
      kind: 'approve.request',
      needs: 'owner:approve',
      status: 'open',
      at: NOW - 1.5 * HOUR
    })
    const journal = [...turns, approve]
    const before = JSON.stringify(journal)
    const feed = hqPlusFoldChats(hqPlusLog(journal, [], NOW - 12 * HOUR))
    expect(JSON.stringify(journal)).toBe(before)
    const s1 = feed.filter((item) => item.sessionId === 's1')
    expect(s1).toHaveLength(1)
    expect(s1[0]).toMatchObject({ kind: 'line', title: 'All done', at: NOW - HOUR })
    expect(s1[0].kind === 'line' ? s1[0].earlier?.map((turn) => turn.title) : null).toEqual([
      'Took it',
      'Did X'
    ])
    expect(
      feed.map((item) =>
        item.kind === 'card' ? item.type : item.kind === 'line' ? item.title : item.text
      )
    ).toEqual(['Other chat', 'approve', 'All done'])
  })
})

describe('hqPlusWithLiveChats', () => {
  const live = {
    sessionId: 's9',
    project: 'kite',
    room: 'acme',
    title: 'New chat',
    at: NOW - 10_000,
    activeAt: null
  }

  it('gives a just-started chat its card before the journal has a row of it', () => {
    const feed = hqPlusFoldChats(hqPlusWithLiveChats([], [live]))
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      kind: 'line',
      tone: 'agent',
      sessionId: 's9',
      title: 'New chat'
    })
  })

  it('keeps the card while the chat has only its effort row and the owner message', () => {
    const rows = [
      row({ kind: 'chat.effort', sessionId: 's9', at: NOW - 8_000, source: 'effort:ok:high' }),
      row({ kind: 'chat.message', sessionId: 's9', at: NOW - 8_000, title: 'From HQ+: go on' })
    ]
    const feed = hqPlusFoldChats(hqPlusWithLiveChats(hqPlusLog(rows, [], NOW - HOUR), [live]))
    expect(feed.filter((item) => item.kind === 'line')).toEqual([
      expect.objectContaining({ id: 'live:s9', tone: 'agent' })
    ])
  })

  it('lets the journal rows carry the card once the chat has one', () => {
    const turn = row({ sessionId: 's9', at: NOW - 5_000, title: 'Took it' })
    const feed = hqPlusFoldChats(hqPlusWithLiveChats(hqPlusLog([turn], [], NOW - HOUR), [live]))
    expect(feed.filter((item) => item.sessionId === 's9')).toHaveLength(1)
    expect(feed[0]).toMatchObject({ id: turn.id, title: 'Took it' })
  })

  it('moves a chat that starts working again below what came after its last turn', () => {
    const turn = row({ id: 'old', sessionId: 's9', at: NOW - 2 * HOUR, title: 'Took it' })
    const later = row({ id: 'later', sessionId: 's1', at: NOW - HOUR, title: 'Other chat' })
    const restarted = { ...live, activeAt: NOW - 1_000 }
    const log = hqPlusLog([turn, later], [], NOW - 3 * HOUR)
    const feed = hqPlusLiftActiveChats(hqPlusFoldChats(hqPlusWithLiveChats(log, [restarted])), [
      restarted
    ])
    expect(feed.map((item) => item.id)).toEqual([later.id, turn.id])
    expect(feed[1]).toMatchObject({ at: NOW - 1_000, title: 'Took it' })
  })
})

describe('hqPlusInFeedFilter', () => {
  it('sorts the feed into your move, chats and inbox; background lines show in All only', () => {
    const log = hqPlusLog(
      [
        row({ id: 'chat', at: NOW - 3 * HOUR, title: 'kite: login works' }),
        row({
          id: 'held',
          kind: 'approve.request',
          needs: 'owner:approve',
          status: 'open',
          refKind: 'draft',
          refId: 'd1'
        })
      ],
      [
        bell({ id: 'ap', kind: 'outgoing-approval', refId: 'd1' }),
        bell({ id: 'rp', kind: 'hq-report', refId: 'daily/2026-10-23.md' }),
        bell({ id: 'limit', kind: 'claude-chat-limit', title: 'A chat hit its limit' })
      ],
      DAY_START
    )
    const ids = (filter: HqPlusFeedFilter): string[] =>
      log.filter((item) => hqPlusInFeedFilter(item, filter)).map((item) => item.id)
    expect(ids('all')).toHaveLength(log.length)
    // Why: an unread report waits on the owner too, so it is both «Your move» and «Inbox».
    expect(ids('move')).toEqual(['held', 'inbox:rp'])
    expect(ids('chats')).toEqual(['chat'])
    expect(ids('inbox')).toEqual(['inbox:rp'])
    const filtered = new Set([...ids('move'), ...ids('chats'), ...ids('inbox')])
    expect(log.filter((item) => !filtered.has(item.id)).map((item) => item.id)).toEqual([
      'inbox:limit'
    ])
  })
})

describe('hqPlusMatchesSearch', () => {
  it('finds a row by its words, project or the person it names, ignoring case', () => {
    const log = hqPlusLog(
      [
        row({ id: 'kite', project: 'kite', title: 'Login works' }),
        row({
          id: 'ann',
          project: 'mill',
          kind: 'waiting.open',
          needs: 'owner:reply',
          status: 'open',
          personId: 'p1',
          title: 'keys'
        })
      ],
      [],
      DAY_START
    )
    const found = (query: string): string[] =>
      log
        .filter((item) => hqPlusMatchesSearch(item, query, (id) => (id === 'p1' ? 'Ann' : null)))
        .map((item) => item.id)
    expect(found('LOGIN')).toEqual(['kite'])
    expect(found('mill')).toEqual(['ann'])
    expect(found('ann')).toEqual(['ann'])
    expect(found('  ')).toEqual([])
  })
})

describe('hqPlusDaysAgo', () => {
  it('counts calendar days, so late last night is yesterday', () => {
    const now = new Date(2026, 9, 23, 0, 30).getTime()
    expect(hqPlusDaysAgo(new Date(2026, 9, 22, 23, 50).getTime(), now)).toBe(1)
    expect(hqPlusDaysAgo(new Date(2026, 9, 23, 0, 5).getTime(), now)).toBe(0)
    expect(
      hqPlusSameDay(new Date(2026, 9, 20, 1).getTime(), new Date(2026, 9, 20, 23).getTime())
    ).toBe(true)
  })
})
