import { describe, expect, it } from 'vitest'
import { hqIntakeBellItem, type HqIntake } from '../../shared/hq-slack-intake'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import {
  closeHqIntake,
  keepHqIntakeInNotes,
  type HqIntakeActionDeps
} from './hq-slack-intake-actions'

const intake: HqIntake = {
  channel: 'D0AAAAAAAAA',
  ts: '1792600000.000100',
  threadTs: null,
  author: 'Anna L.',
  authorSlackId: 'U1',
  venue: 'dm',
  text: 'Вот реализация роутов по чату',
  links: ['https://claude.ai/artifact/abc'],
  files: [],
  permalink: 'https://example.slack.com/archives/D0AAAAAAAAA/p1792600000000100',
  at: 1_792_600_000_000,
  repoId: 'r1',
  project: 'support-service',
  summary: 'Анна прислал роуты'
}

function setup() {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => 1_792_600_100_000, newId: () => `id${++id}` })
  db.upsertPerson({ name: 'Анна', slackUserId: 'U1' })
  const item = db.addInboxItem(hqIntakeBellItem(intake)).record
  const deps: HqIntakeActionDeps = {
    openItems: () => db.listInbox(),
    people: () => db.listPeople(),
    addPerson: (name, slackUserId) => db.upsertPerson({ name, slackUserId }),
    openWaitings: () => db.listWaitings({ status: 'open' }),
    addWaiting: (input) => db.addWaiting(input),
    closeWaiting: (waitingId, resolution) =>
      void db.closeWaiting(waitingId, 'resolved', resolution),
    markRead: (itemId) => void db.markInboxRead(itemId),
    markDone: (itemId, action) => void db.markInboxDone(itemId, action)
  }
  return { db, item, deps }
}

describe('hq-slack-intake actions', () => {
  it('keeps a message in Notes once, on the person Orca+ knows, with its source', () => {
    const { db, item, deps } = setup()
    expect(keepHqIntakeInNotes(deps, item.id, { project: null, note: 'после релиза' })).toEqual({
      ok: true
    })
    keepHqIntakeInNotes(deps, item.id, { project: null, note: '' })
    const notes = db.listWaitings({ status: 'open' })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      direction: 'on-me',
      title: 'В работу: Анна прислал роуты',
      project: 'support-service',
      source: 'intake',
      sourceRef: 'slack:D0AAAAAAAAA:1792600000.000100'
    })
    expect(notes[0]?.detail).toContain('Note: после релиза')
    expect(db.listPeople().map((person) => person.name)).toEqual(['Анна'])
    expect(db.listInbox().find((entry) => entry.id === item.id)?.readAt).not.toBeNull()
  })

  it('closes the card and its Notes line once the message went to a chat', () => {
    const { db, item, deps } = setup()
    keepHqIntakeInNotes(deps, item.id, { project: null, note: '' })
    closeHqIntake(deps, item.id, { action: 'sent', resolution: 'Sent to «Routes»' })
    expect(db.listWaitings({ status: 'open' })).toEqual([])
    expect(db.listInbox()).toEqual([])
  })
})
