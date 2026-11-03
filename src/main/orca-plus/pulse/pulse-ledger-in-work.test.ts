import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const KEY = 'slack:C0ACME:1700000000.000100'

function setup() {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => 1_000, newId: () => `id-${++id}` })
  open.push(db)
  const { conversationId } = db.ingestLedgerSignal({
    key: KEY,
    ts: '1700000000.000100',
    at: 1_000,
    author: 'Bob',
    authorId: 'U_BOB',
    fromOwner: false,
    text: 'From the 16th the agent drafts specs for every change request',
    link: null,
    reader: 'slack-api',
    forOwner: true,
    project: null,
    title: 'Bob announces spec drafts'
  })
  return { db, conversationId }
}

// Custom build (hq-in-work, owner 03.11): plan stage 20.11, scenario C13.
describe('a conversation already in work in a chat', () => {
  it('leaves the cards, keeps the chat, and is written as a state guess', () => {
    const { db, conversationId } = setup()
    expect(db.listLedgerCards(0).map((row) => row.id)).toEqual([conversationId])
    expect(db.attribution.inWork.candidates(0).map((row) => row.id)).toEqual([conversationId])

    expect(
      db.attribution.inWork.set(conversationId, 'claude_specs', 'named', 'link found', 1)
    ).toBe(true)

    expect(db.listLedgerCards(0)).toEqual([])
    expect(db.attribution.inWork.candidates(0)).toEqual([])
    expect(db.attribution.inWork.list(0)).toMatchObject([
      { id: conversationId, sessionId: 'claude_specs', title: 'Bob announces spec drafts' }
    ])
    const [conversation] = db.listLedgerFeed(0).conversations
    expect(conversation).toMatchObject({
      state: 'fyi',
      stateWhy: 'in-work',
      sessionId: 'claude_specs'
    })
    expect(db.attribution.records()).toContainEqual({
      field: 'state',
      guess: 'in-work',
      guess_how: 'named',
      final: null,
      final_how: null
    })
  })

  it('«Not in work» brings the card back and counts the guess as changed', () => {
    const { db, conversationId } = setup()
    db.attribution.inWork.set(conversationId, 'claude_specs', 'model', 'same plan', 0.8)

    expect(db.attribution.inWork.clear(conversationId)).toBe(true)

    expect(db.listLedgerCards(0).map((row) => row.id)).toEqual([conversationId])
    expect(db.attribution.records()).toContainEqual({
      field: 'state',
      guess: 'in-work',
      guess_how: 'model',
      final: 'you',
      final_how: 'edit'
    })
    expect(db.attribution.inWork.clear(conversationId)).toBe(false)
  })

  it('does not take a conversation that no longer waits on the owner', () => {
    const { db, conversationId } = setup()
    db.attribution.inWork.set(conversationId, 'claude_specs', 'named', null)
    expect(db.attribution.inWork.set(conversationId, 'claude_other', 'named', null)).toBe(false)
    expect(db.attribution.inWork.list(0)[0]?.sessionId).toBe('claude_specs')
  })

  it('the model decision with in_work takes the card down at once', () => {
    const { db, conversationId } = setup()
    db.attribution.decide(conversationId, {
      project: 'acme-agents',
      how: 'model',
      state: 'you',
      gist: 'Драфты спек агентом',
      chat: 'claude_specs',
      kind: 'fyi',
      inWork: true,
      confidence: 0.82,
      why: 'the chat builds the spec-draft agent'
    })
    expect(db.listLedgerCards(0)).toEqual([])
    expect(db.attribution.inWork.list(0)[0]?.sessionId).toBe('claude_specs')
  })

  it('remembers the conversations each chat was already shown', () => {
    const { db } = setup()
    db.attribution.inWork.noteChecked('claude_specs', ['c1', 'c2'])
    db.attribution.inWork.noteChecked('claude_specs', ['c3'])
    expect([...db.attribution.inWork.checked(0)]).toEqual([
      ['claude_specs', new Set(['c1', 'c2', 'c3'])]
    ])
  })
})
