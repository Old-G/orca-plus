// Custom build (pulse-hot-indexes): the lookups HQ runs after every pulse write read by index, never
// by a whole-table scan, and an older file picks the indexes up without a version bump.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqJournalInput } from '../../../shared/hq-journal'
import Database from '../../sqlite/sync-database'
import { liveSessionOf } from './pulse-chat-chain'
import { PulseCore } from './pulse-core'
import { syncInboxKind } from './pulse-inbox'
import { listJournal, recordJournal } from './pulse-journal'
import { PULSE_SCHEMA_VERSION } from './pulse-schema'

const cores: PulseCore[] = []
const directories: string[] = []

function openCore(path = ':memory:'): PulseCore {
  let tick = 1_000
  let id = 0
  const core = new PulseCore(path, { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  cores.push(core)
  return core
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const core of cores.splice(0)) {
    try {
      core.close()
    } catch {
      // closed by the test
    }
  }
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/** Every SELECT `run` prepares, with SQLite's plan for it. */
function plansOf(core: PulseCore, run: () => void): { sql: string; plan: string }[] {
  const statements = new Set<string>()
  const prepare = core.db.prepare.bind(core.db)
  const spy = vi.spyOn(core.db, 'prepare').mockImplementation((sql: string) => {
    statements.add(sql)
    return prepare(sql)
  })
  run()
  spy.mockRestore()
  return [...statements]
    .filter((sql) => /^\s*SELECT/i.test(sql))
    .map((sql) => ({
      sql,
      plan: core.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => String(row.detail))
        .join(' | ')
    }))
}

function scans(plans: { sql: string; plan: string }[], table: string): string[] {
  return plans
    .filter(({ plan }) => new RegExp(`\\bSCAN ${table}\\b`).test(plan))
    .map(({ sql, plan }) => `${sql} -> ${plan}`)
}

function entry(overrides: Partial<HqJournalInput> = {}): HqJournalInput {
  return {
    workspace: 'acme',
    kind: 'chat.report',
    project: 'acme-api',
    address: 'acme-api/billing',
    sessionId: 'session-1',
    personId: null,
    title: 'Done: invoices paginate',
    needs: 'owner:decide',
    replyTo: null,
    refKind: null,
    refId: null,
    source: 'chat-report',
    dedupeKey: 'report-1',
    ...overrides
  }
}

describe('pulse hot-path indexes', () => {
  it('syncs a bell kind without scanning the inbox for answered keys', () => {
    const core = openCore()
    const bell = (key: string) => ({ kind: 'hq-remind', title: key, dedupeKey: key })
    syncInboxKind(core, 'hq-remind', [bell('ann'), bell('bob')])
    const plans = plansOf(core, () => {
      syncInboxKind(core, 'hq-remind', [bell('ann'), bell('carol')])
    })
    expect(plans.length).toBeGreaterThan(0)
    expect(scans(plans, 'inbox')).toEqual([])
  })

  it('reads one chat, open rows, a kind since a moment, a source and a key by index', () => {
    const core = openCore()
    recordJournal(core, [entry(), entry({ dedupeKey: 'report-2', status: 'done' })])
    const plans = plansOf(core, () => {
      listJournal(core, { kind: 'chat.report', sessionId: 'session-1', oldestFirst: true })
      listJournal(core, { kind: 'chat.report', sessionId: 'session-1', limit: 1 })
      listJournal(core, { kind: 'chat.report', needs: 'owner', status: 'open', limit: 500 })
      listJournal(core, { kind: 'chat.report', since: 0, limit: 300 })
      listJournal(core, { source: 'hq-sessions', limit: 500 })
      listJournal(core, { source: 'hq-sessions', dedupeKey: 'report-1', limit: 1 })
    })
    expect(plans).toHaveLength(6)
    expect(scans(plans, 'journal')).toEqual([])
  })

  it('follows a handoff chain by index', () => {
    const core = openCore()
    const plans = plansOf(core, () => {
      liveSessionOf(core, 'session-1')
    })
    expect(plans.length).toBeGreaterThan(0)
    expect(scans(plans, 'sessions')).toEqual([])
    expect(scans(plans, 'journal')).toEqual([])
  })

  it('finds a row by its key, and only that row', () => {
    const core = openCore()
    recordJournal(core, [entry(), entry({ dedupeKey: 'report-2', title: 'Done: exports' })])
    const found = listJournal(core, { dedupeKey: 'report-1', limit: 1 })
    expect(found.map((row) => row.title)).toEqual(['Done: invoices paginate'])
    expect(listJournal(core, { source: 'other', dedupeKey: 'report-1' })).toEqual([])
  })

  it('adds the indexes to a file already at the current version, keeping its version', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pulse-hot-indexes-'))
    directories.push(directory)
    const path = join(directory, 'orca-plus-pulse.db')
    openCore(path).close()
    const raw = new Database(path)
    try {
      for (const index of [
        'inbox_by_dedupe',
        'journal_by_kind_session',
        'journal_by_kind_status',
        'journal_by_kind_at',
        'journal_by_source',
        'sessions_by_parent'
      ]) {
        raw.exec(`DROP INDEX ${index}`)
      }
    } finally {
      raw.close()
    }
    openCore(path).close()
    const check = new Database(path)
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(PULSE_SCHEMA_VERSION)
      const names = check
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .all()
        .map((row) => String(row.name))
      expect(names).toEqual(
        expect.arrayContaining([
          'inbox_by_dedupe',
          'journal_by_kind_session',
          'journal_by_kind_status',
          'journal_by_kind_at',
          'journal_by_source',
          'sessions_by_parent'
        ])
      )
    } finally {
      check.close()
    }
  })
})
