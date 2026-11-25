import { afterEach, describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../../shared/hq-ledger'
import { PulseCore } from './pulse-core'
import { ingestLedgerSignal } from './pulse-ledger'
import { LEDGER_DRAFT_EVENT } from './pulse-ledger-draft'
import { FORGOTTEN_MAIL_TITLE, forgetLedgerMail, HQ_MAIL_KEEP_MS } from './pulse-ledger-forget'

const DAY = 24 * 60 * 60_000
const NOW = 100 * DAY
const open: PulseCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) {
    core.close()
  }
})

function openCore(): PulseCore {
  let id = 0
  const core = new PulseCore(':memory:', { now: () => NOW, newId: () => `id-${++id}` })
  open.push(core)
  return core
}

function letter(over: Partial<HqLedgerSignal>): HqLedgerSignal {
  return {
    key: 'gmail:thread-a',
    ts: 'msg-1',
    at: NOW - DAY,
    author: 'Ann Lee',
    authorId: 'ann@acme.example',
    fromOwner: false,
    text: 'Secret letter text',
    link: 'https://mail.google.com/mail/?authuser=owner%40acme.example#all/thread-a',
    reader: 'gmail-letters',
    forOwner: true,
    project: null,
    title: 'Contract renewal',
    ...over
  }
}

/** What the ledger keeps of a conversation, whole, so a test sees any leftover text. */
function dump(core: PulseCore, id: string): string {
  return JSON.stringify({
    conversation: core.db.prepare('SELECT * FROM conversations WHERE id = ?').all(id),
    messages: core.db
      .prepare('SELECT * FROM conversation_messages WHERE conversation_id = ?')
      .all(id),
    events: core.db
      .prepare("SELECT kind, payload FROM events WHERE entity = 'conversation' AND entity_id = ?")
      .all(id),
    attribution: core.db.prepare('SELECT * FROM attribution_log').all(),
    waitings: core.db.prepare('SELECT * FROM waitings WHERE conversation_id = ?').all(id),
    waitingEvents: core.db
      .prepare(
        `SELECT kind, payload FROM events WHERE entity = 'waiting'
          AND entity_id IN (SELECT id FROM waitings WHERE conversation_id = ?)`
      )
      .all(id)
  })
}

/** A waiting answered by the letter `ts`, with the snapshot event the reply reader writes. */
function answered(core: PulseCore, id: string, conversationId: string, ts: string, text: string) {
  core.transaction(() => {
    core.db
      .prepare(
        `INSERT INTO waitings (id, direction, title, source, created_at, conversation_id, reply, reply_author, reply_ts, replied_at)
         VALUES (?, 'on-them', 'Renewal', 'test', ?, ?, ?, 'Ann Lee', ?, ?)`
      )
      .run(id, NOW - 2 * DAY, conversationId, text, ts, NOW - DAY)
    core.emit('waiting.replied', 'waiting', id, {
      id,
      reply: text,
      replyAuthor: 'Ann Lee',
      replyAuthorId: 'ann@acme.example',
      replyLink: 'https://mail.google.com/mail/#all/thread-a',
      replyTs: ts,
      repliedAt: NOW - DAY
    })
  })
}

function decorate(core: PulseCore, conversationId: string, key: string, ts: string): void {
  core.transaction(() => {
    core.emit(LEDGER_DRAFT_EVENT, 'conversation', conversationId, {
      lastTs: ts,
      kind: 'reply',
      ask: 'Ann asks to renew the contract',
      draft: 'Sure, renewing'
    })
    core.db
      .prepare(
        `INSERT INTO attribution_log (id, conversation_key, source, field, guess, guess_how, why, guessed_at)
         VALUES (?, ?, 'gmail', 'kind', 'reply', 'model', 'Ann wants the renewal', ?)`
      )
      .run(`attr-${conversationId}`, key, NOW)
  })
  answered(core, `wait-${conversationId}`, conversationId, ts, 'Secret letter text')
}

describe('forgetLedgerMail', () => {
  it('on disconnect keeps only the conversation id, project and times of every mail thread', () => {
    const core = openCore()
    const mail = ingestLedgerSignal(core, letter({ project: 'acme-site' }))
    decorate(core, mail.conversationId, 'gmail:thread-a', 'msg-1')
    const slack = ingestLedgerSignal(
      core,
      letter({
        key: 'slack:C1:1.0',
        ts: '1.0',
        reader: 'slack-mention',
        text: 'Slack words',
        title: 'Slack thread'
      })
    )

    expect(forgetLedgerMail(core)).toEqual({ conversations: 1, messages: 1 })

    const kept = dump(core, mail.conversationId)
    for (const leaked of [
      'Secret letter text',
      'Contract renewal',
      'Ann',
      'acme.example',
      'thread-a',
      'msg-1',
      'renew'
    ]) {
      expect(kept).not.toContain(leaked)
    }
    const row = core.db
      .prepare(
        'SELECT key, title, state, project, created_at, last_at FROM conversations WHERE id = ?'
      )
      .get(mail.conversationId)
    expect(row).toEqual({
      key: `gmail-removed:${mail.conversationId}`,
      title: FORGOTTEN_MAIL_TITLE,
      state: 'done',
      project: 'acme-site',
      created_at: NOW - DAY,
      last_at: NOW - DAY
    })
    // The waiting still knows it was answered and when.
    expect(
      core.db
        .prepare('SELECT replied_at FROM waitings WHERE id = ?')
        .get(`wait-${mail.conversationId}`)
    ).toEqual({ replied_at: NOW - DAY })
    // Another place's conversation is untouched.
    expect(dump(core, slack.conversationId)).toContain('Slack words')
    // A second pass finds nothing left to forget.
    expect(forgetLedgerMail(core)).toEqual({ conversations: 0, messages: 0 })
  })

  it('after 30 days forgets a quiet thread whole and old letters of a thread still going', () => {
    const core = openCore()
    const cutoff = NOW - HQ_MAIL_KEEP_MS
    const quiet = ingestLedgerSignal(core, letter({ at: cutoff - DAY }))
    decorate(core, quiet.conversationId, 'gmail:thread-a', 'msg-1')
    const going = ingestLedgerSignal(
      core,
      letter({ key: 'gmail:thread-b', ts: 'old', at: cutoff - DAY, text: 'Old words' })
    )
    ingestLedgerSignal(
      core,
      letter({ key: 'gmail:thread-b', ts: 'new', at: NOW - DAY, text: 'Fresh words' })
    )
    answered(core, 'wait-old', going.conversationId, 'old', 'Old answer')
    answered(core, 'wait-new', going.conversationId, 'new', 'Fresh answer')

    expect(forgetLedgerMail(core, cutoff)).toEqual({ conversations: 1, messages: 2 })

    expect(dump(core, quiet.conversationId)).not.toContain('Secret letter text')
    const left = dump(core, going.conversationId)
    expect(left).toContain('Fresh words')
    expect(left).toContain('Fresh answer')
    expect(left).not.toContain('Old words')
    expect(left).not.toContain('Old answer')
  })
})
