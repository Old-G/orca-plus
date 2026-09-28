import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []

function openDb(): PulseDb {
  let tick = 1_000
  let id = 0
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  open.push(db)
  return db
}

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

describe('people', () => {
  it('finds a person again by Slack id and keeps fields the update leaves out', () => {
    const db = openDb()
    const ann = db.upsertPerson({ name: 'Ann', slackUserId: 'U1', role: 'PM' })
    const again = db.upsertPerson({ name: 'Ann Lee', slackUserId: 'U1', clickupUserId: '42' })
    expect(again).toMatchObject({ id: ann.id, name: 'Ann Lee', role: 'PM', clickupUserId: '42' })
    expect(db.listPeople()).toHaveLength(1)
    expect(db.upsertPerson({ id: ann.id, name: 'Ann', role: null }).role).toBeNull()
  })

  it('searches by name, treating % and _ literally', () => {
    const db = openDb()
    db.upsertPerson({ name: 'Ann' })
    db.upsertPerson({ name: 'Bob_Ops' })
    expect(db.listPeople('an').map((p) => p.name)).toEqual(['Ann'])
    expect(db.listPeople('_').map((p) => p.name)).toEqual(['Bob_Ops'])
  })

  it('refuses to update a person that does not exist', () => {
    expect(() => openDb().upsertPerson({ id: 'nope', name: 'X' })).toThrow(/no person/)
  })
})

describe('waitings', () => {
  it('filters by direction, status, person and project, newest first', () => {
    const db = openDb()
    const ann = db.upsertPerson({ name: 'Ann' })
    db.addWaiting({ direction: 'on-them', title: 'old', personId: ann.id, source: 'manual' })
    const newer = db.addWaiting({
      direction: 'on-them',
      title: 'new',
      personId: ann.id,
      project: 'app-a',
      source: 'agent'
    })
    db.addWaiting({ direction: 'on-me', title: 'mine', source: 'agent' })
    expect(db.listWaitings({ direction: 'on-them' }).map((w) => w.title)).toEqual(['new', 'old'])
    expect(db.listWaitings({ project: 'app-a' }).map((w) => w.id)).toEqual([newer.id])
    db.closeWaiting(newer.id, 'resolved')
    expect(db.listWaitings({ status: 'open', personId: ann.id }).map((w) => w.title)).toEqual([
      'old'
    ])
  })

  it('rejects an unknown person id', () => {
    expect(() =>
      openDb().addWaiting({ direction: 'on-me', title: 'x', personId: 'ghost', source: 'agent' })
    ).toThrow(/FOREIGN KEY/)
  })
})

describe('drafts and approvals', () => {
  it('never re-adds a draft with the same fingerprint, even after it was rejected', () => {
    const db = openDb()
    const first = db.addDraft({
      kind: 'clickup-task',
      body: 'Fix login',
      source: 'slack-scout',
      fingerprint: 'slack:C1:1700'
    })
    db.decideDraft(first.record.id, 'rejected')
    const again = db.addDraft({
      kind: 'clickup-task',
      body: 'Fix login (again)',
      source: 'slack-scout',
      fingerprint: 'slack:C1:1700'
    })
    expect(again).toMatchObject({ created: false, record: { id: first.record.id } })
    expect(again.record.status).toBe('rejected')
    expect(db.listDrafts()).toHaveLength(1)
  })

  it('an edited approval replaces the text and logs one approval', () => {
    const db = openDb()
    const { record } = db.addDraft({
      kind: 'message',
      target: 'U1',
      body: 'hi',
      source: 'agent'
    })
    const { draft, decision } = db.decideDraft(record.id, 'edited', 'Hi Ann, any news?')
    expect(draft).toMatchObject({ status: 'approved', body: 'Hi Ann, any news?' })
    expect(decision).toMatchObject({ kind: 'approval', outcome: 'edited', draftId: record.id })
    expect(db.listDecisions()).toEqual([decision])
  })

  it('sends an approved draft at most once and keeps rejections final', () => {
    const db = openDb()
    const sent = db.addDraft({ kind: 'message', body: 'a', source: 'agent' }).record
    db.decideDraft(sent.id, 'approved')
    db.markDraftDelivery(sent.id, 'failed')
    expect(db.markDraftDelivery(sent.id, 'sent').status).toBe('sent')
    expect(() => db.markDraftDelivery(sent.id, 'sent')).toThrow(/cannot go from sent/)
    const pending = db.addDraft({ kind: 'message', body: 'b', source: 'agent' }).record
    expect(() => db.markDraftDelivery(pending.id, 'sent')).toThrow(/from pending to sent/)
    db.decideDraft(pending.id, 'rejected')
    expect(() => db.decideDraft(pending.id, 'approved')).toThrow(/from rejected/)
  })

  it('a failed decision leaves the draft and the log untouched', () => {
    const db = openDb()
    const { record } = db.addDraft({ kind: 'message', body: 'a', source: 'agent' })
    expect(() => db.decideDraft(record.id, 'edited', '  ')).toThrow(/edited text/)
    db.decideDraft(record.id, 'approved')
    expect(() => db.decideDraft(record.id, 'rejected')).toThrow()
    expect(db.getDraft(record.id)?.status).toBe('approved')
    expect(db.listDecisions()).toHaveLength(1)
  })
})

describe('decisions', () => {
  it('logs a decision and records its HQ mirror', () => {
    const db = openDb()
    const decision = db.logDecision({ title: 'Ship on Monday', source: 'agent', project: 'app-a' })
    expect(db.listDecisions({ unmirrored: true })).toEqual([decision])
    db.setDecisionMirror(decision.id, 'decisions/2026-09-28-ship-on-monday.md')
    expect(db.listDecisions({ unmirrored: true })).toEqual([])
    expect(db.listDecisions()[0]?.mirroredPath).toBe('decisions/2026-09-28-ship-on-monday.md')
    expect(() => db.setDecisionMirror('nope', 'x.md')).toThrow(/no decision/)
  })
})

describe('inbox', () => {
  it('raises a keyed item once while it is open, and again after it is done', () => {
    const db = openDb()
    const input = { kind: 'limit', title: 'Account A at 90%', dedupeKey: 'limit:A:5h' }
    const first = db.addInboxItem(input)
    expect(db.addInboxItem(input)).toMatchObject({
      created: false,
      record: { id: first.record.id }
    })
    db.markInboxDone(first.record.id, 'switch')
    expect(db.addInboxItem(input).created).toBe(true)
  })

  it('lists open items urgent first and keeps the first answer', () => {
    const db = openDb()
    const normal = db.addInboxItem({ kind: 'review', title: 'PR 1' }).record
    const urgent = db.addInboxItem({
      kind: 'blocked-agent',
      title: 'Agent waits',
      urgency: 'urgent',
      actions: [{ id: 'open', label: 'Open' }]
    }).record
    expect(db.listInbox().map((i) => i.id)).toEqual([urgent.id, normal.id])
    expect(db.listInbox()[0]?.actions).toEqual([{ id: 'open', label: 'Open' }])
    expect(db.markInboxRead(normal.id).readAt).not.toBeNull()
    db.markInboxDone(urgent.id, 'open')
    expect(db.markInboxDone(urgent.id, 'dismiss').doneAction).toBe('open')
    expect(db.listInbox().map((i) => i.id)).toEqual([normal.id])
    expect(db.listInbox({ includeDone: true })).toHaveLength(2)
  })
})
