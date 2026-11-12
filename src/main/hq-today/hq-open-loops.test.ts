import { afterEach, describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../shared/hq-ledger'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { runHqOpenLoops, type HqOpenLoopsDeps } from './hq-open-loops'

const HOUR = 60 * 60_000
const T0 = Date.UTC(2026, 10, 2, 9)
let tick = T0
const open: PulseDb[] = []

function openDb(): PulseDb {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => tick, newId: () => `id-${++id}` })
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function say(db: PulseDb, hours: number, over: Partial<HqLedgerSignal>): void {
  const at = T0 + hours * HOUR
  db.ingestLedgerSignal({
    key: `slack:D0ANNLEE:${at / 1000}.000100`,
    ts: `${at / 1000}.000100`,
    at,
    author: 'Ann Lee',
    authorId: 'UANN',
    fromOwner: false,
    text: 'hi',
    link: `https://acme.example/m/${at}`,
    reader: 'slack-api',
    forOwner: true,
    project: null,
    title: 'DM',
    ...over
  })
}

const owner = { author: 'Olga Owner', authorId: 'UOWNER', fromOwner: true }

function deps(db: PulseDb): HqOpenLoopsDeps {
  const loops = db.attribution.openLoops
  return {
    enabled: () => true,
    timelines: loops.timelines,
    owner: loops.owner,
    records: loops.records,
    record: loops.record,
    waitings: () => db.listWaitings(),
    people: () => db.listPeople(),
    lastLineAt: () =>
      db.listJournal({ kind: 'job.report', source: 'job:open-loops', limit: 1 })[0]?.at ?? null,
    journal: (rows) => void db.recordJournal(rows),
    now: () => tick
  }
}

function lines(db: PulseDb): string[] {
  return db
    .listJournal({ kind: 'job.report', source: 'job:open-loops' })
    .map((entry) => entry.body ?? '')
}

describe('runHqOpenLoops', () => {
  it('reports a question unanswered for three days once, and touches no waiting', () => {
    const db = openDb()
    say(db, -5, { text: 'hi, a question about tokens' })
    say(db, 0, { ...owner, text: 'Can you rotate the token?' })
    tick = T0 + 71 * HOUR
    expect(runHqOpenLoops(deps(db)).opened).toBe(0)
    tick = T0 + 73 * HOUR
    expect(runHqOpenLoops(deps(db))).toMatchObject({ opened: 1, line: true })
    tick = T0 + 75 * HOUR
    expect(runHqOpenLoops(deps(db))).toMatchObject({ opened: 0, line: false })
    expect(db.listWaitings({ status: 'open' })).toEqual([])
    expect(lines(db)).toHaveLength(1)
    expect(lines(db)[0]).toContain('open on-them · Ann Lee · asked 2026-11-02')
    expect(lines(db)[0]).not.toContain('rotate the token')
  })

  it('closes it on her answer in the thread and lists that in the next hourly line', () => {
    const db = openDb()
    const thread = { key: 'slack:C0DEVOPS01:1793000000.000100' }
    say(db, -5, { ...thread, text: 'the token expired again' })
    say(db, 0, { ...thread, ...owner, text: '<@UANN> можешь перевыпустить токен?' })
    tick = T0 + 73 * HOUR
    runHqOpenLoops(deps(db))
    say(db, 73.5, { ...thread, text: 'сделаю сегодня' })
    tick = T0 + 73.6 * HOUR
    expect(runHqOpenLoops(deps(db))).toMatchObject({ closed: 1, line: false })
    tick = T0 + 75 * HOUR
    expect(runHqOpenLoops(deps(db))).toMatchObject({ closed: 0, line: true })
    expect(lines(db)[0]).toContain('close on-them · Ann Lee')
  })

  it('does not list a verdict again in the next line when events are written after the pass began', () => {
    const db = openDb()
    say(db, -5, { text: 'hi' })
    say(db, 0, { ...owner, text: 'Can you rotate the token?' })
    const late = (at: number): HqOpenLoopsDeps => ({ ...deps(db), now: () => at - 50 })
    tick = T0 + 73 * HOUR
    runHqOpenLoops(late(tick))
    tick = T0 + 75 * HOUR
    expect(runHqOpenLoops(late(tick)).line).toBe(false)
    expect(lines(db)).toHaveLength(1)
  })

  it('closes a loop asked under a ClickUp raw id once the reader names the task by its custom id', () => {
    const db = openDb()
    say(db, -5, { key: 'clickup:86abc12xy', ts: 'sent:0', reader: 'sent', text: 'hi', link: null })
    say(db, 0, {
      ...owner,
      key: 'clickup:86abc12xy',
      ts: 'sent:1',
      reader: 'sent',
      text: '@Ann Lee can you confirm the price list?',
      link: null
    })
    tick = T0 + 73 * HOUR
    expect(runHqOpenLoops(deps(db)).opened).toBe(1)
    say(db, 74, {
      key: 'clickup:DEV-7',
      ts: 'comment:2',
      reader: 'clickup-api',
      text: 'Confirmed, it is final.',
      link: 'https://app.clickup.com/t/86abc12xy?comment=2'
    })
    tick = T0 + 75 * HOUR
    expect(runHqOpenLoops(deps(db)).closed).toBe(1)
  })

  it('notes a waiting an agent already recorded for the same talk', () => {
    const db = openDb()
    say(db, -5, { text: 'hi' })
    say(db, 0, { ...owner, text: 'Can you rotate the token?' })
    const agent = db.addWaiting({
      direction: 'on-them',
      title: 'Token rotation',
      source: 'slack',
      sourceRef: `slack:D0ANNLEE:${(T0 - 5 * HOUR) / 1000}.000100`
    })
    tick = T0 + 73 * HOUR
    runHqOpenLoops(deps(db))
    expect(db.attribution.openLoops.records(0)).toMatchObject([{ covered: agent.id }])
  })

  it('reads a ClickUp task named by its raw id in a send and by its custom id in the reader as one', () => {
    const db = openDb()
    say(db, 0, {
      key: 'clickup:DEV-7',
      ts: 'comment:1',
      reader: 'clickup-api',
      text: '@Olga Owner can you confirm the price list?',
      link: 'https://app.clickup.com/t/86abc12xy?comment=1'
    })
    say(db, 2, {
      ...owner,
      key: 'clickup:86abc12xy',
      ts: 'sent:2',
      reader: 'sent',
      text: 'Confirmed, the list is final.',
      link: null
    })
    tick = T0 + 30 * HOUR
    expect(runHqOpenLoops(deps(db)).opened).toBe(0)
  })
})
