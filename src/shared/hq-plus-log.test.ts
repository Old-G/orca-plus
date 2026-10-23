import { describe, expect, it } from 'vitest'
import type { HqJournalEntry } from './hq-journal'
import type { PulseInboxItem } from './pulse-types'
import { hqPlusGraph, hqPlusLanes } from './hq-plus-river-graph'
import { hqPlusAsksOwner, hqPlusChoices, hqPlusLog, hqPlusWaiting } from './hq-plus-log'
import { parseHqPlusReport, summarizeHqPlusReport } from './hq-plus-screen'
import { hqPlusFoldChats } from './hq-plus-fold'

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
    expect(feed.map((item) => (item.kind === 'card' ? item.type : item.title))).toEqual([
      'Other chat',
      'approve',
      'All done'
    ])
  })
})
