import { afterEach, describe, expect, it } from 'vitest'
import type { OutgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import { PulseDb } from './pulse-db'
import type { HqAgentSend } from './pulse-sent'

const open: PulseDb[] = []
let tick = 0
function openDb(): PulseDb {
  let id = 0
  tick = 1_792_000_000_000
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const CHAT = 'orca-session-ann'
const DM = 'slack:D0ANN00002:1792000005.000100'
const THREAD = 'slack:C0ACME0001:1791999000.000100'

function send(over: Partial<HqAgentSend>): HqAgentSend {
  return {
    key: DM,
    ts: '1792000005.000100',
    at: tick + 1,
    text: 'Ann, can you share the Q3 file?',
    link: 'https://acme.slack.com/archives/D0ANN00002/p1792000005000100',
    title: 'Ann, can you share the Q3 file?',
    project: 'app',
    sessionId: CHAT,
    call: { sessionId: 'claude-1', toolUseId: 'toolu_1' },
    ...over
  }
}

function context(over: Partial<OutgoingSentContext>): OutgoingSentContext {
  return {
    service: 'Slack',
    operation: 'send message',
    targetName: 'DM with Ann',
    targetId: 'U0ANN00001',
    threadTs: null,
    replyingTo: null,
    chatName: 'Export chat',
    agentSessionId: CHAT,
    worktreeId: 'wt-1',
    project: 'app',
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

/** A held call the owner approved, keyed as the gate keys it. */
function approve(db: PulseDb, body: string, sent: OutgoingSentContext, toolUseId = 'toolu_1') {
  const { record } = db.addDraft({
    kind: 'message',
    body,
    source: 'gate',
    fingerprint: `gate:claude-1:${toolUseId}`
  })
  return db.decideDraft(record.id, 'approved', undefined, sent).decision
}

function messagesOf(db: PulseDb, key: string) {
  return db.listLedgerFeed(0).conversations.find((c) => c.key === key)?.messages ?? []
}

describe('recordAgentSend', () => {
  it('puts an ungated DM opened by user id in its D… channel, held by the chat that sent it', () => {
    const db = openDb()
    const result = db.recordAgentSend(send({}))
    expect(result).toMatchObject({ added: true, step: 'owner' })
    const [conversation] = db.listLedgerConversations()
    expect(conversation).toMatchObject({ key: DM, sessionId: CHAT, project: 'app', state: 'fyi' })
    expect(messagesOf(db, DM)).toMatchObject([
      { direction: 'out', text: 'Ann, can you share the Q3 file?' }
    ])
  })

  it('is one row however often the result arrives, and the Slack reader reading it back adds none', () => {
    const db = openDb()
    db.recordAgentSend(send({}))
    expect(db.recordAgentSend(send({})).added).toBe(false)
    const reread = db.ingestLedgerSignal({
      key: DM,
      ts: '1792000005.000100',
      at: tick,
      author: 'Owner',
      authorId: 'U0OWNER001',
      fromOwner: true,
      text: 'Ann, can you share the Q3 file?',
      link: null,
      reader: 'slack-api',
      forOwner: false,
      project: null,
      title: 'x'
    })
    expect(reread.added).toBe(false)
    expect(messagesOf(db, DM)).toHaveLength(1)
  })

  it('supersedes the row an approval put in the thread: the message is there once, with its real ts', () => {
    const db = openDb()
    const decision = approve(
      db,
      'Ann, done',
      context({ targetId: 'C0ACME0001', threadTs: '1791999000.000100' })
    )
    expect(messagesOf(db, THREAD)).toHaveLength(1)
    db.recordAgentSend(send({ key: THREAD, ts: '1792000009.000100', text: 'Ann, done' }))
    const rows = messagesOf(db, THREAD)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ text: 'Ann, done', direction: 'out' })
    const waiting = db.addWaiting({
      direction: 'on-them',
      title: 'Ann: done?',
      source: 'slack',
      agentSessionId: CHAT
    })
    expect(db.getWaitingRecord(waiting.id)).toMatchObject({
      decision_id: decision.id,
      sent_text: 'Ann, done',
      source_ref: THREAD
    })
  })

  it('moves an approval recorded at a guessed place to the real one and drops what it alone made there', () => {
    const db = openDb()
    approve(db, 'Bob, who owns the import?', context({ targetId: 'C0ACME0001', taskId: 'DEV-1' }))
    expect(db.listLedgerConversations().map((c) => c.key)).toEqual(['clickup:DEV-1'])
    const top = 'slack:C0ACME0001:1792000020.000100'
    db.recordAgentSend(
      send({ key: top, ts: '1792000020.000100', text: 'Bob, who owns the import?' })
    )
    expect(db.listLedgerConversations().map((c) => c.key)).toEqual([top])
  })

  it('fills the place an approval did not know (a DM by user id) and the waiting takes it', () => {
    const db = openDb()
    const decision = approve(db, 'Ann, can you share the Q3 file?', context({}))
    expect(db.listLedgerConversations()).toEqual([])
    db.recordAgentSend(send({}))
    const waiting = db.addWaiting({
      direction: 'on-them',
      title: 'Ann: Q3 file',
      source: 'slack',
      agentSessionId: CHAT
    })
    const raw = db.getWaitingRecord(waiting.id)
    expect(raw).toMatchObject({
      decision_id: decision.id,
      sent_text: 'Ann, can you share the Q3 file?',
      source_ref: DM,
      expects: 'data'
    })
    expect(raw.conversation_id).toBe(db.listLedgerConversations()[0].id)
    expect(db.listLedgerConversations()[0].state).toBe('wait')
  })
})

describe('pairing a waiting with an ungated send', () => {
  it('gives the chat’s next waiting the exact text and place of its last send', () => {
    const db = openDb()
    db.recordAgentSend(
      send({
        key: 'gitlab:acme/app!12',
        ts: 'note:3000000001',
        text: 'Ann, please re-review',
        link: 'https://gitlab.com/acme/app/-/merge_requests/12#note_3000000001'
      })
    )
    const waiting = db.addWaiting({
      direction: 'on-them',
      title: 'Ann: re-review app !12',
      source: 'gitlab',
      agentSessionId: CHAT
    })
    expect(db.getWaitingRecord(waiting.id)).toMatchObject({
      decision_id: null,
      sent_text: 'Ann, please re-review',
      source_ref: 'https://gitlab.com/acme/app/-/merge_requests/12#note_3000000001'
    })
    expect(db.listLedgerConversations()[0]).toMatchObject({ state: 'wait', sessionId: CHAT })
  })

  it('a send of another chat, one already taken, or one older than half an hour pairs with nothing', () => {
    const db = openDb()
    db.recordAgentSend(send({ key: 'clickup:DEV-1', ts: 'comment:1', text: 'Bob?' }))
    const other = db.addWaiting({
      direction: 'on-them',
      title: 'q',
      source: 'clickup',
      agentSessionId: 'orca-session-bob'
    })
    expect(db.getWaitingRecord(other.id).sent_text).toBeNull()
    const first = db.addWaiting({
      direction: 'on-them',
      title: 'q1',
      source: 'clickup',
      agentSessionId: CHAT
    })
    expect(db.getWaitingRecord(first.id).sent_text).toBe('Bob?')
    const second = db.addWaiting({
      direction: 'on-them',
      title: 'q2',
      source: 'clickup',
      agentSessionId: CHAT,
      allowDuplicate: true
    })
    expect(db.getWaitingRecord(second.id).sent_text).toBeNull()
    db.recordAgentSend(send({ key: 'clickup:DEV-2', ts: 'comment:2', text: 'Ann?' }))
    tick += 31 * 60_000
    const late = db.addWaiting({
      direction: 'on-them',
      title: 'q3',
      source: 'clickup',
      agentSessionId: CHAT,
      allowDuplicate: true
    })
    expect(db.getWaitingRecord(late.id).sent_text).toBeNull()
  })
})
