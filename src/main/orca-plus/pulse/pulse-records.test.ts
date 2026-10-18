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
  it('returns the open note that says the same instead of adding it again', () => {
    const db = openDb()
    const timur = db.upsertPerson({ name: 'Timur' })
    const first = db.addWaiting({
      direction: 'on-them',
      title: 'Выгрузка за март готова?',
      personId: timur.id,
      source: 'slack'
    })
    const again = db.addWaiting({
      direction: 'on-them',
      title: 'готовность выгрузки за март',
      personId: timur.id,
      source: 'agent'
    })
    expect(again).toMatchObject({ id: first.id, duplicate: true })
    expect(db.listWaitings()).toHaveLength(1)
    const forced = db.addWaiting({
      direction: 'on-them',
      title: 'готовность выгрузки за март',
      personId: timur.id,
      source: 'agent',
      allowDuplicate: true
    })
    expect(forced.id).not.toBe(first.id)
    expect(forced.duplicate).toBeUndefined()
  })

  it('updates an open note in place and refuses a closed one', () => {
    const db = openDb()
    const note = db.addWaiting({ direction: 'on-them', title: 'Export', source: 'note', dueAt: 5 })
    const updated = db.updateWaiting(note.id, { title: 'Export for March', detail: 'csv' })
    expect(updated).toMatchObject({ title: 'Export for March', detail: 'csv', dueAt: 5 })
    expect(db.updateWaiting(note.id, { dueAt: null }).dueAt).toBeNull()
    expect(db.getWaiting(note.id)).toMatchObject({ title: 'Export for March', dueAt: null })
    db.closeWaiting(note.id, 'resolved')
    expect(() => db.updateWaiting(note.id, { title: 'x' })).toThrow(/already resolved/)
  })

  it('keeps the chat that waits and only the newest answer from the thread', () => {
    const db = openDb()
    const waiting = db.addWaiting({
      direction: 'on-them',
      title: 'Export',
      source: 'slack',
      agentSessionId: 'chat-1',
      worktreeId: 'wt-1'
    })
    expect(waiting).toMatchObject({ agentSessionId: 'chat-1', worktreeId: 'wt-1', reply: null })
    const replied = db.recordWaitingReply(waiting.id, {
      text: 'Tomorrow',
      author: 'Ann',
      ts: '2.5'
    })
    expect(replied).toMatchObject({ reply: 'Tomorrow', replyAuthor: 'Ann', replyDeliveredAt: null })
    expect(db.recordWaitingReply(waiting.id, { text: 'old', author: 'Ann', ts: '2.1' })).toBeNull()
    expect(db.markWaitingReplyDelivered(waiting.id)?.replyDeliveredAt).toEqual(expect.any(Number))
    expect(db.markWaitingReplyDelivered(waiting.id)).toBeNull()
    const newer = db.recordWaitingReply(waiting.id, { text: 'Done', author: 'Ann', ts: '3.0' })
    expect(newer).toMatchObject({ reply: 'Done', replyTs: '3.0', replyDeliveredAt: null })
    db.closeWaiting(waiting.id, 'resolved')
    expect(db.recordWaitingReply(waiting.id, { text: 'late', author: 'Ann', ts: '9' })).toBeNull()
  })

  it('moves only the open waitings of a handed-off chat to its successor', () => {
    const db = openDb()
    const asked = { direction: 'on-them', source: 'slack', agentSessionId: 'chat-old' } as const
    const open = db.addWaiting({ ...asked, title: 'Export', paneKey: 'tab:1', worktreeId: 'wt-1' })
    const closed = db.addWaiting({ ...asked, title: 'Done' })
    const other = db.addWaiting({ ...asked, title: 'Other', agentSessionId: 'chat-x' })
    db.closeWaiting(closed.id, 'resolved')
    expect(db.moveOpenWaitingsToChat('chat-old', 'chat-new').map((w) => w.id)).toEqual([open.id])
    expect(db.getWaiting(open.id)).toMatchObject({
      agentSessionId: 'chat-new',
      paneKey: null,
      worktreeId: 'wt-1'
    })
    expect(db.getWaiting(closed.id)?.agentSessionId).toBe('chat-old')
    expect(db.getWaiting(other.id)?.agentSessionId).toBe('chat-x')
  })

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

  it('lists one kind since a time, done items included', () => {
    const db = openDb()
    const early = db.addInboxItem({ kind: 'agent-finished', title: 'A' }).record
    db.addInboxItem({ kind: 'review', title: 'PR 1' })
    const late = db.addInboxItem({ kind: 'agent-finished', title: 'B' }).record
    db.markInboxDone(late.id, 'seen')
    const listed = db.listInbox({
      includeDone: true,
      kind: 'agent-finished',
      since: early.createdAt
    })
    expect(listed.map((i) => i.id)).toEqual([late.id, early.id])
    expect(
      db.listInbox({ includeDone: true, kind: 'agent-finished', since: late.createdAt })
    ).toEqual([expect.objectContaining({ id: late.id })])
  })
})
