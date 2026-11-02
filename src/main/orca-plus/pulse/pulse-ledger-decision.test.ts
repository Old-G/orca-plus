import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const KEY = 'slack:D0ANN12345:1700000000.000100'

function setup() {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => 1_000, newId: () => `id-${++id}` })
  open.push(db)
  const { conversationId } = db.ingestLedgerSignal({
    key: KEY,
    ts: '1700000000.000100',
    at: 1_000,
    author: 'Ann',
    authorId: 'U_ANN',
    fromOwner: false,
    text: 'глянь, пожалуйста',
    link: null,
    reader: 'slack-api',
    forOwner: true,
    project: null,
    title: 'глянь, пожалуйста'
  })
  return { db, conversationId }
}

// Custom build (hq-intake-decide, owner 03.11): plan stage 20.3.
describe('the model decision in the ledger', () => {
  it('writes project and chat as guesses with certainty, and the feed carries them', () => {
    const { db, conversationId } = setup()
    db.attribution.decide(conversationId, {
      project: 'acme-api',
      how: 'model',
      state: 'you',
      gist: 'Посмотреть MR',
      chat: 'claude_mr314',
      confidence: 0.86,
      why: 'MR !314 in the DM'
    })

    expect(db.attribution.records()).toEqual([
      { field: 'project', guess: 'acme-api', guess_how: 'model', final: null, final_how: null },
      { field: 'chat', guess: 'claude_mr314', guess_how: 'model', final: null, final_how: null }
    ])
    db.attribution.attempt()
    expect(db.attribution.attemptsSince(0)).toBe(1)
    const [conversation] = db.listLedgerFeed(0).conversations
    expect(conversation?.guess).toEqual({
      chat: 'claude_mr314',
      confidence: 0.86,
      why: 'MR !314 in the DM'
    })
  })

  it('sending to the chat the model proposed counts it kept', () => {
    const { db, conversationId } = setup()
    db.attribution.decide(conversationId, {
      project: 'acme-api',
      how: 'model',
      state: 'you',
      gist: null,
      chat: 'claude_mr314',
      confidence: 0.86,
      why: null
    })
    db.attribution.take({
      key: KEY,
      proposedProject: 'acme-api',
      proposedChat: 'claude_mr314',
      project: 'acme-api',
      chat: 'claude_mr314'
    })

    const chat = db.attribution.accuracy(0).slices.find((slice) => slice.field === 'chat')
    expect(chat).toMatchObject({ confirmed: 1, edited: 0 })
    expect(db.attribution.hints('slack:D0ANN12345:')).toEqual([])
  })
})
