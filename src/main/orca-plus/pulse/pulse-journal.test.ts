import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HqJournalInput } from '../../../shared/hq-journal'
import Database from '../../sqlite/sync-database'
import { PulseDb, pulseDbPath } from './pulse-db'
import { PULSE_SCHEMA_VERSION } from './pulse-schema'

const open: PulseDb[] = []
const directories: string[] = []

function openDb(path = ':memory:'): PulseDb {
  let tick = 1_000
  let id = 0
  const db = new PulseDb(path, { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  open.push(db)
  return db
}

afterEach(async () => {
  for (const db of open.splice(0)) {
    try {
      db.close()
    } catch {
      // closed by the test
    }
  }
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function input(overrides: Partial<HqJournalInput> = {}): HqJournalInput {
  return {
    workspace: 'acme',
    kind: 'waiting.open',
    project: 'acme-api',
    address: null,
    sessionId: null,
    personId: null,
    title: 'Waiting on Ann: signed contract',
    needs: 'person:ann',
    replyTo: null,
    refKind: 'waiting',
    refId: 'w1',
    source: 'pulse-wait:manual',
    dedupeKey: 'waiting.open:w1',
    ...overrides
  }
}

describe('journal', () => {
  it('adds a dedupe key once and only settles it forward, each change an event', () => {
    const db = openDb()
    expect(db.recordJournal([input()])).toEqual({ added: 1, settled: 0, moved: 0 })
    expect(db.recordJournal([input()])).toEqual({ added: 0, settled: 0, moved: 0 })
    expect(db.recordJournal([input({ status: 'done' })])).toEqual({
      added: 0,
      settled: 1,
      moved: 0
    })
    // Why: a source still reporting it open must not reopen what was settled.
    expect(db.recordJournal([input({ status: 'open' })])).toEqual({
      added: 0,
      settled: 0,
      moved: 0
    })
    expect(db.listJournal().map((entry) => entry.status)).toEqual(['done'])
    expect(db.listEventsSince(0).map((event) => [event.kind, event.entity])).toEqual([
      ['journal.added', 'journal'],
      ['journal.done', 'journal']
    ])
  })

  it('moves a row only on a firm placement, or out of no room on a guess', () => {
    const db = openDb()
    db.recordJournal([input({ workspace: '_unassigned', project: 'Kite' })])
    // Why: a guess (the default room) may place a row nobody had placed…
    expect(
      db.recordJournal([input({ workspace: 'home', project: 'kite', placement: 'fallback' })])
    ).toMatchObject({ moved: 1 })
    // …but never pulls one out of a real room, as a misread workspace file would.
    expect(
      db.recordJournal([input({ workspace: '_unassigned', project: null, placement: 'fallback' })])
    ).toMatchObject({ moved: 0 })
    expect(
      db.recordJournal([input({ workspace: 'hobby', project: 'kite', placement: 'firm' })])
    ).toMatchObject({ moved: 1 })
    expect(db.recordJournal([input({ workspace: 'acme' })])).toMatchObject({ moved: 0 })
    expect(db.listJournal().map((entry) => entry.workspace)).toEqual(['hobby'])
    expect(db.listEventsSince(0).at(-1)?.kind).toBe('journal.moved')
  })

  it('settles the older open rows a newer row of the same ref supersedes', () => {
    const db = openDb()
    const reply = (ts: string): HqJournalInput =>
      input({ kind: 'person.reply', needs: 'agent:a', dedupeKey: `r:${ts}`, supersedes: true })
    db.recordJournal([reply('1')])
    expect(db.recordJournal([reply('2')])).toMatchObject({ added: 1, settled: 1 })
    expect(db.listJournal({ kind: 'person.reply' }).map((e) => [e.dedupeKey, e.status])).toEqual([
      ['r:2', 'open'],
      ['r:1', 'done']
    ])
  })

  it('refuses a needs value outside the vocabulary and rolls the batch back', () => {
    const db = openDb()
    expect(() => db.recordJournal([input(), input({ dedupeKey: 'x', needs: 'whoever' })])).toThrow(
      /needs/
    )
    expect(db.listJournal()).toEqual([])
  })

  it('filters by room, party, kind family and project', () => {
    const db = openDb()
    db.recordJournal([
      input({ at: 10 }),
      input({ at: 20, kind: 'approve.request', needs: 'owner:approve', dedupeKey: 'a1' }),
      input({ at: 30, kind: 'approve.result', needs: 'nobody', dedupeKey: 'a2' }),
      input({ at: 40, workspace: 'hobby', project: 'Kite', dedupeKey: 'h1' })
    ])
    const titles = (query: Parameters<PulseDb['listJournal']>[0]) =>
      db.listJournal(query).map((entry) => `${entry.workspace}/${entry.kind}`)
    expect(titles({ workspaces: ['acme'] })).toEqual([
      'acme/approve.result',
      'acme/approve.request',
      'acme/waiting.open'
    ])
    expect(titles({ needs: 'owner' })).toEqual(['acme/approve.request'])
    expect(titles({ kind: 'approve.*', since: 25 })).toEqual(['acme/approve.result'])
    expect(titles({ project: 'kite' })).toEqual(['hobby/waiting.open'])
    expect(titles({ workspaces: [] })).toEqual([])
  })

  it('counts rows and gives one work row per project and slot', () => {
    const db = openDb()
    db.recordJournal([
      input({ at: 10, kind: 'chat.report', dedupeKey: 'r1', sessionId: 's0' }),
      input({ at: 40, kind: 'chat.report', dedupeKey: 'r2', sessionId: 's1' }),
      input({ at: 130, kind: 'chat.report', dedupeKey: 'r3' }),
      input({ at: 140, dedupeKey: 'w2' })
    ])
    expect(db.countJournal(100)).toBe(2)
    const activity = db
      .journalActivity({ since: 0, slotMs: 100, kinds: ['chat.report'] })
      .map((row) => `${row.project}@${row.at}`)
      .sort()
    expect(activity).toEqual(['acme-api@130', 'acme-api@40'])
    expect(
      db.journalActivity({ since: 0, slotMs: 100, kinds: ['chat.report'] }).find((row) => row.at === 40)
        ?.sessionId
    ).toBe('s1')
  })

  it('keeps one session row, moved only by newer sightings', () => {
    const db = openDb()
    const sighting = {
      sessionId: 'claude_1',
      address: null,
      agent: 'claude',
      worktreeId: 'r1::/w',
      workspace: 'acme',
      project: 'acme-api',
      state: 'done' as const,
      contextPct: null,
      parentSessionId: null,
      taskRef: null
    }
    expect(db.noteSessions([{ ...sighting, at: 50 }])).toBe(1)
    expect(db.noteSessions([{ ...sighting, at: 20, state: 'working' }])).toBe(1)
    expect(db.noteSessions([{ ...sighting, at: 50 }])).toBe(0)
    expect(db.getSession('claude_1')).toMatchObject({
      state: 'done',
      openedAt: 20,
      lastActivityAt: 50,
      project: 'acme-api'
    })
  })
})

describe('journal migration', () => {
  it('lifts a version 7 file and keeps what it held', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orca-pulse-journal-'))
    directories.push(directory)
    const path = pulseDbPath(directory)
    const first = openDb(path)
    first.addWaiting({ direction: 'on-them', title: 'Contract from Ann', source: 'manual' })
    first.close()
    const raw = new Database(path)
    raw.exec('DROP TABLE journal; DROP TABLE sessions')
    // Why: version 9 (hq-plus-person-replies) came after.
    raw.exec('ALTER TABLE waitings DROP COLUMN reply_author_id')
    raw.pragma('user_version = 7')
    raw.close()

    const lifted = openDb(path)
    expect(lifted.listWaitings().map((w) => w.title)).toEqual(['Contract from Ann'])
    expect(lifted.recordJournal([input()]).added).toBe(1)
    lifted.close()
    const check = new Database(path)
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(PULSE_SCHEMA_VERSION)
    } finally {
      check.close()
    }
  })

  // Custom build (hq-plus-ask)
  it('finds rows by every word, past the newest page and across letter case', () => {
    const db = openDb()
    db.recordJournal([
      input({
        title: 'Ann ответила про реактивацию',
        body: 'Решили: всегда вручную',
        dedupeKey: 'a'
      }),
      ...Array.from({ length: 60 }, (_, i) => input({ title: `Noise ${i}`, dedupeKey: `n${i}` })),
      input({
        title: 'Спросили Bob о доступе',
        links: [{ kind: 'slack', url: 'https://acme.example/archives/C1/p1' }],
        dedupeKey: 'b'
      })
    ])
    expect(db.listJournal({ text: 'РЕАКТИВАЦ вручную', limit: 5 }).map((e) => e.dedupeKey)).toEqual(
      ['a']
    )
    expect(db.listJournal({ text: 'archives/C1' }).map((e) => e.dedupeKey)).toEqual(['b'])
    expect(db.listJournal({ text: 'реактивац bob' })).toEqual([])
  })
})
