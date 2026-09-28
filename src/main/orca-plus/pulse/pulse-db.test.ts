import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { onPulseChanged } from './pulse-change-events'
import { PulseCore } from './pulse-core'
import { PulseDb, pulseDbPath } from './pulse-db'
import { latestEventSeq } from './pulse-events'
import { PULSE_SCHEMA_VERSION } from './pulse-schema'

const directories: string[] = []
const open: PulseDb[] = []

async function tempPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orca-pulse-'))
  directories.push(directory)
  return pulseDbPath(directory)
}

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

describe('PulseDb schema', () => {
  it('creates every table at the current version', async () => {
    const path = await tempPath()
    openDb(path).close()
    const raw = new Database(path)
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(PULSE_SCHEMA_VERSION)
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name)
      expect(tables).toEqual(
        expect.arrayContaining(['decisions', 'drafts', 'events', 'inbox', 'people', 'waitings'])
      )
      expect(raw.pragma('journal_mode', { simple: true })).toBe('wal')
    } finally {
      raw.close()
    }
  })

  it('keeps records across a reopen and does not migrate twice', async () => {
    const path = await tempPath()
    const first = openDb(path)
    first.addWaiting({ direction: 'on-them', title: 'Contract from Ann', source: 'manual' })
    first.close()
    const second = openDb(path)
    expect(second.listWaitings().map((w) => w.title)).toEqual(['Contract from Ann'])
  })

  it('refuses a file written by a newer schema', async () => {
    const path = await tempPath()
    const raw = new Database(path)
    raw.pragma(`user_version = ${PULSE_SCHEMA_VERSION + 1}`)
    raw.close()
    expect(() => openDb(path)).toThrow(/newer than this build/)
  })

  it.skipIf(process.platform === 'win32')('restricts the file to the owner', async () => {
    const path = await tempPath()
    openDb(path)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe('PulseDb events', () => {
  it('appends one event per change, in order, with the record as payload', () => {
    const db = openDb()
    const waiting = db.addWaiting({ direction: 'on-me', title: 'Review', source: 'agent' })
    db.closeWaiting(waiting.id, 'resolved', 'done')
    const events = db.listEventsSince(0)
    expect(events.map((e) => [e.kind, e.entityId])).toEqual([
      ['waiting.added', waiting.id],
      ['waiting.resolved', waiting.id]
    ])
    expect(events[1]?.payload).toMatchObject({ status: 'resolved', resolution: 'done' })
    expect(events[1]!.seq).toBeGreaterThan(events[0]!.seq)
    expect(db.latestEventSeq()).toBe(events[1]!.seq)
  })

  it('pages from a seq, so a reader resumes where it stopped', () => {
    const db = openDb()
    for (const title of ['a', 'b', 'c']) {
      db.addWaiting({ direction: 'on-me', title, source: 'agent' })
    }
    const [first] = db.listEventsSince(0, 1)
    expect(db.listEventsSince(first!.seq).map((e) => e.payload)).toMatchObject([
      { title: 'b' },
      { title: 'c' }
    ])
  })

  it('writes no event for a change that failed', () => {
    const db = openDb()
    const waiting = db.addWaiting({ direction: 'on-me', title: 'Once', source: 'agent' })
    db.closeWaiting(waiting.id, 'cancelled')
    const before = db.latestEventSeq()
    expect(() => db.closeWaiting(waiting.id, 'resolved')).toThrow(/already cancelled/)
    expect(db.latestEventSeq()).toBe(before)
  })

  it('rolls back the record and its event together when a write throws midway', () => {
    const core = new PulseCore(':memory:')
    try {
      expect(() =>
        core.transaction(() => {
          core.db
            .prepare(
              "INSERT INTO waitings (id, direction, title, source, created_at) VALUES ('w', 'on-me', 't', 'agent', 1)"
            )
            .run()
          core.emit('waiting.added', 'waiting', 'w', {})
          throw new Error('boom')
        })
      ).toThrow('boom')
      expect(core.db.prepare('SELECT COUNT(*) AS n FROM waitings').get()?.n).toBe(0)
      expect(latestEventSeq(core)).toBe(0)
    } finally {
      core.close()
    }
  })

  it('tells followers about committed changes only', () => {
    const db = openDb()
    let heard = 0
    const stop = onPulseChanged(() => {
      heard += 1
    })
    try {
      const waiting = db.addWaiting({ direction: 'on-me', title: 'Once', source: 'agent' })
      expect(heard).toBe(1)
      db.closeWaiting(waiting.id, 'resolved')
      expect(() => db.closeWaiting(waiting.id, 'resolved')).toThrow()
      db.listWaitings()
      expect(heard).toBe(2)
    } finally {
      stop()
    }
  })

  it('prunes old events but keeps the records and the seq moving forward', () => {
    const db = openDb()
    db.addWaiting({ direction: 'on-me', title: 'old', source: 'agent' })
    const cut = db.listEventsSince(0)[0]!.at + 1
    expect(db.pruneEvents(cut)).toBe(1)
    const next = db.addWaiting({ direction: 'on-me', title: 'new', source: 'agent' })
    expect(db.listWaitings()).toHaveLength(2)
    expect(db.listEventsSince(0).map((e) => [e.seq, e.entityId])).toEqual([[2, next.id]])
  })
})
