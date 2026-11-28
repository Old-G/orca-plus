import { afterEach, describe, expect, it } from 'vitest'
import type { HqJournalInput } from '../../../shared/hq-journal'
import {
  onPulseChanged,
  pulseChangeBeyond,
  pulseChangeTouches,
  type PulseChange
} from './pulse-change-events'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
const unsubscribe: (() => void)[] = []

function openDb(): PulseDb {
  let tick = 1_000
  let id = 0
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  open.push(db)
  return db
}

function listen(): PulseChange[] {
  const heard: PulseChange[] = []
  unsubscribe.push(onPulseChanged((change) => heard.push(change)))
  return heard
}

afterEach(() => {
  for (const off of unsubscribe.splice(0)) {
    off()
  }
  for (const db of open.splice(0)) {
    db.close()
  }
})

const journalRow: HqJournalInput = {
  workspace: 'acme',
  kind: 'chat.report',
  project: 'acme-api',
  address: null,
  sessionId: null,
  personId: null,
  title: 'Reported',
  needs: 'person:ann',
  replyTo: null,
  refKind: null,
  refId: null,
  source: 'chat.report',
  dedupeKey: 'report:1'
}

describe('pulse change entities', () => {
  it('a journal row reaches followers as a journal-only change', () => {
    const db = openDb()
    const heard = listen()
    db.recordJournal([journalRow])
    expect(heard).toHaveLength(1)
    expect([...(heard[0].entities ?? [])]).toEqual(['journal'])
    expect(pulseChangeBeyond(heard[0], ['journal', 'conversation'])).toBe(false)
    expect(pulseChangeTouches(heard[0], 'inbox')).toBe(false)
  })

  it('an inbox card reaches followers as an inbox change', () => {
    const db = openDb()
    const heard = listen()
    db.addInboxItem({ kind: 'agent-finished', title: 'Done', refId: 'r1' })
    expect(heard).toHaveLength(1)
    expect(pulseChangeTouches(heard[0], 'inbox')).toBe(true)
    expect(pulseChangeBeyond(heard[0], ['journal', 'conversation'])).toBe(true)
  })

  it('a write that changed nothing is not heard', () => {
    const db = openDb()
    db.recordJournal([journalRow])
    const heard = listen()
    db.recordJournal([journalRow])
    expect(heard).toEqual([])
  })

  it('an unknown change counts as touching everything', () => {
    const unknown: PulseChange = { entities: null }
    expect(pulseChangeBeyond(unknown, ['journal'])).toBe(true)
    expect(pulseChangeTouches(unknown, 'inbox')).toBe(true)
  })

  it('a change beyond the ignored entities counts', () => {
    const mixed: PulseChange = { entities: new Set(['journal', 'waiting']) }
    expect(pulseChangeBeyond(mixed, ['journal', 'conversation'])).toBe(true)
    expect(pulseChangeTouches(mixed, 'inbox')).toBe(false)
  })
})
