// Custom build (pulse): the open database plus what every record module shares — one transaction
// per write, and an event appended inside it, so the feed never shows a change that rolled back.
import { randomUUID } from 'node:crypto'
import Database from '../../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../../sqlite/harden-database-files'
import type { PulseEntity } from '../../../shared/pulse-types'
import { emitPulseChanged } from './pulse-change-events'
import { migratePulseSchema } from './pulse-schema'

export type PulseClock = {
  now: () => number
  newId: () => string
}

export class PulseCore {
  readonly db: Database.Database
  readonly clock: PulseClock
  // Custom build (p1-perf): what the open transaction touched, so followers can skip writes they
  // do not read (a journal row every few seconds re-ran the whole journal sync).
  private touched = new Set<PulseEntity>()

  constructor(path: (string & {}) | ':memory:', clock: Partial<PulseClock> = {}) {
    this.clock = { now: clock.now ?? Date.now, newId: clock.newId ?? randomUUID }
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('foreign_keys = ON')
    try {
      migratePulseSchema(this.db)
    } catch (error) {
      this.db.close()
      throw error
    }
    hardenSqliteDatabaseFiles(path)
  }

  /** Runs `write` in one IMMEDIATE transaction; a throw rolls back the record and its event. */
  transaction<T>(write: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    this.touched = new Set()
    let result: T
    try {
      result = write()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    // Why: followers hear only about writes that committed and changed something.
    if (this.touched.size > 0) {
      emitPulseChanged({ entities: this.touched })
    }
    return result
  }

  /** Call inside `transaction`. */
  emit(kind: string, entity: PulseEntity, entityId: string, payload: unknown): void {
    this.touched.add(entity)
    this.db
      .prepare('INSERT INTO events (at, kind, entity, entity_id, payload) VALUES (?, ?, ?, ?, ?)')
      .run(this.clock.now(), kind, entity, entityId, JSON.stringify(payload))
  }

  close(): void {
    this.db.close()
  }
}
