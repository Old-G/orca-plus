import { afterEach, describe, expect, it } from 'vitest'
import type { OutgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import { PulseDb } from './pulse-db'
import { hqWaitingExpects } from './pulse-outbox'

const open: PulseDb[] = []
let tick = 0
function openDb(): PulseDb {
  let id = 0
  tick = 1_000_000
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function context(over: Partial<OutgoingSentContext>): OutgoingSentContext {
  return {
    service: 'Slack',
    operation: 'send message',
    targetName: '#hub',
    targetId: 'C0123HUBXY',
    threadTs: '1700000000.000100',
    replyingTo: null,
    chatName: 'Hub chat',
    agentSessionId: 'claude_s1',
    worktreeId: 'wt-1',
    project: 'hub',
    head: null,
    taskId: null,
    taskUrl: null,
    taskName: null,
    ref: null,
    footer: null,
    movedTo: null,
    ...over
  }
}

describe('outbox', () => {
  it('an approved message joins its thread as the owner’s and the chat’s next waiting takes it', () => {
    const db = openDb()
    const { record } = db.addDraft({
      kind: 'message',
      body: 'Ann, please approve !386',
      source: 'gate'
    })
    const { decision } = db.decideDraft(record.id, 'approved', undefined, context({}))
    const conversations = db.listLedgerConversations()
    expect(conversations).toHaveLength(1)
    expect(conversations[0]).toMatchObject({
      key: 'slack:C0123HUBXY:1700000000.000100',
      messages: 1
    })

    const waiting = db.addWaiting({
      direction: 'on-them',
      title: 'Ann: approve hub !386',
      source: 'slack',
      agentSessionId: 'claude_s1'
    })
    const raw = db.getWaitingRecord(waiting.id)
    expect(raw).toMatchObject({
      decision_id: decision.id,
      draft_id: record.id,
      sent_text: 'Ann, please approve !386',
      expects: 'approve',
      source_ref: 'slack:C0123HUBXY:1700000000.000100'
    })
  })

  it('a waiting of another chat, or after half an hour, takes nothing', () => {
    const db = openDb()
    const { record } = db.addDraft({ kind: 'message', body: 'x', source: 'gate' })
    db.decideDraft(record.id, 'approved', undefined, context({}))
    const other = db.addWaiting({
      direction: 'on-them',
      title: 'q',
      source: 'slack',
      agentSessionId: 'claude_s2'
    })
    expect(db.getWaitingRecord(other.id).decision_id).toBeNull()
    tick += 31 * 60_000
    const late = db.addWaiting({
      direction: 'on-them',
      title: 'q2',
      source: 'slack',
      agentSessionId: 'claude_s1',
      allowDuplicate: true
    })
    expect(db.getWaitingRecord(late.id).decision_id).toBeNull()
  })

  it('a rejected draft records nothing', () => {
    const db = openDb()
    const { record } = db.addDraft({ kind: 'message', body: 'x', source: 'gate' })
    db.decideDraft(record.id, 'rejected', undefined, context({}))
    expect(db.listLedgerConversations()).toEqual([])
  })

  it('reads what a waiting waits for from its words', () => {
    expect(hqWaitingExpects('Апрув hub !386')).toBe('approve')
    expect(hqWaitingExpects('Влить hub !381')).toBe('merge')
    expect(hqWaitingExpects('Ключи из функций Zoho в Connections')).toBe('access')
    expect(hqWaitingExpects('Полный список клиентов')).toBe('data')
    expect(hqWaitingExpects('Что решили по DEV-1?')).toBe('answer')
  })
})
