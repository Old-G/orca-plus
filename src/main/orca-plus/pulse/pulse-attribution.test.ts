import { afterEach, describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../../shared/hq-ledger'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
let tick = 0
function openDb(): PulseDb {
  let id = 0
  tick = 1_000_000
  const db = new PulseDb(':memory:', { now: () => tick, newId: () => `id-${++id}` })
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const THREAD = 'slack:C0123HUBXY:1700000000.000100'
function signal(over: Partial<HqLedgerSignal> = {}): HqLedgerSignal {
  tick += 1
  return {
    key: THREAD,
    ts: `1700000001.00000${tick % 10}`,
    at: tick,
    author: 'Ann',
    authorId: 'U_ANN',
    fromOwner: false,
    text: 'can you look at this?',
    link: null,
    reader: 'slack-mention',
    forOwner: true,
    project: null,
    title: 'Thread',
    ...over
  }
}

function rows(db: PulseDb): Record<string, unknown>[] {
  return db.attribution.records()
}

// Custom build (hq-attribution-log, owner 03.11).
describe('the guess → final log', () => {
  it('writes the project a new conversation got, and the owner changing it counts as an edit', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({ project: 'acme-api' }))
    db.setLedgerProject(THREAD, 'acme-web')

    expect(rows(db)).toEqual([
      {
        field: 'project',
        guess: 'acme-api',
        guess_how: 'rule',
        final: 'acme-web',
        final_how: 'edit'
      }
    ])
    const { slices, topEdits } = db.attribution.accuracy(0)
    expect(slices).toEqual([
      {
        source: 'slack',
        field: 'project',
        decided: 1,
        confirmed: 0,
        edited: 1,
        skipped: 0,
        rate: 0
      }
    ])
    expect(topEdits[0]).toMatchObject({ guess: 'acme-api', final: 'acme-web', count: 1 })
  })

  it('a model guess replaces the open one; sending to the proposed project and chat confirms both', () => {
    const db = openDb()
    const { conversationId } = db.ingestLedgerSignal(signal())
    db.setLedgerGuess(conversationId, {
      project: 'acme-api',
      how: 'model',
      state: 'you',
      gist: null
    })
    db.attribution.take({
      key: THREAD,
      proposedProject: 'acme-api',
      proposedChat: 'new',
      project: 'acme-api',
      chat: 'new'
    })

    expect(rows(db)).toEqual([
      {
        field: 'project',
        guess: 'acme-api',
        guess_how: 'model',
        final: 'acme-api',
        final_how: 'confirm'
      },
      { field: 'chat', guess: 'new', guess_how: 'card', final: 'new', final_how: 'confirm' }
    ])
    expect(db.attribution.accuracy(0).slices.map((slice) => slice.rate)).toEqual([1, 1])
  })

  it('another chat than proposed is a chat edit, the project still confirmed', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({ project: 'acme-api' }))
    db.attribution.take({
      key: THREAD,
      proposedProject: 'acme-api',
      proposedChat: 'session-1',
      project: 'acme-api',
      chat: 'session-2'
    })

    const chat = db.attribution.accuracy(0).slices.find((slice) => slice.field === 'chat')
    expect(chat).toMatchObject({ confirmed: 0, edited: 1, rate: 0 })
  })

  // Why (Codex 03.11): one decision is counted once.
  it('a project picked on the chip is not judged again when the card goes to work', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({ project: 'acme-api' }))
    db.setLedgerProject(THREAD, 'acme-web')
    db.attribution.take({
      key: THREAD,
      proposedProject: 'acme-web',
      proposedChat: 'new',
      project: 'acme-web',
      chat: 'new'
    })

    const project = db.attribution.accuracy(0).slices.find((slice) => slice.field === 'project')
    expect(project).toMatchObject({ decided: 1, edited: 1, confirmed: 0 })
  })

  it('a dropped card is a skip, never counted as right or wrong', () => {
    const db = openDb()
    const key = 'gitlab:acme/hub!7'
    db.ingestLedgerSignal(signal({ key, project: 'hub', reader: 'gitlab-todo' }))
    db.closeLedgerConversation(key)

    expect(db.attribution.accuracy(0).slices).toEqual([
      {
        source: 'gitlab',
        field: 'project',
        decided: 0,
        confirmed: 0,
        edited: 0,
        skipped: 1,
        rate: null
      }
    ])
  })

  it('a choice with no guess written stays out of the count', () => {
    const db = openDb()
    db.setLedgerProject('slack:C0OTHER:1700000000.1', 'hub')

    expect(rows(db)).toEqual([
      { field: 'project', guess: null, guess_how: 'unrecorded', final: 'hub', final_how: 'edit' }
    ])
    expect(db.attribution.accuracy(0).slices).toEqual([])
  })

  it('a no-project guess the owner fills in is a miss', () => {
    const db = openDb()
    const { conversationId } = db.ingestLedgerSignal(signal())
    db.setLedgerGuess(conversationId, { project: null, how: 'model', state: 'you', gist: null })
    db.setLedgerProject(THREAD, 'hub')

    expect(rows(db)).toEqual([
      { field: 'project', guess: null, guess_how: 'reader', final: 'hub', final_how: 'edit' }
    ])
  })

  it('a new message after the owner chose does not reopen his choice', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({ project: 'acme-api' }))
    db.setLedgerProject(THREAD, 'acme-web')
    db.ingestLedgerSignal(signal({ text: 'thanks' }))

    expect(rows(db)).toHaveLength(1)
  })
})
