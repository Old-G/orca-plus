import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'
import { hqIntakeOfConversation } from '../../hq-today/hq-ledger-cards'
import { hqIntakeBellItem } from '../../../shared/hq-slack-intake'

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const KEY = 'slack:C0ACME:1700000000.000100'

function setup() {
  let id = 0
  let now = 1_000
  const db = new PulseDb(':memory:', { now: () => now, newId: () => `id-${++id}` })
  open.push(db)
  const said = (ts: string, text: string, fromOwner = false) =>
    db.ingestLedgerSignal({
      key: KEY,
      ts,
      at: Math.round(Number(ts) * 1000),
      author: fromOwner ? 'Me' : 'Bob',
      authorId: fromOwner ? 'U_ME' : 'U_BOB',
      fromOwner,
      text,
      link: null,
      reader: 'slack-api',
      forOwner: !fromOwner,
      project: null,
      title: 'Bob asks about the export'
    })
  const { conversationId } = said('1700000000.000100', 'Can the export keep the tables?')
  return { db, conversationId, said, tick: (ms: number) => (now += ms) }
}

// Custom build (hq-ledger-draft, plan 20.9 step 1): the scout's kind, ask and draft on the ledger's cards.
describe('a ledger card draft', () => {
  it('keeps the newest draft and counts the day', () => {
    const { db, conversationId } = setup()
    expect(db.attribution.drafts.of(conversationId)).toBeNull()
    db.attribution.drafts.set(conversationId, {
      lastTs: '1700000000.000100',
      kind: 'answer',
      ask: 'Can the export keep the tables?',
      draft: 'Bob, I will look today.'
    })
    db.attribution.drafts.set(conversationId, {
      lastTs: '1700000000.000100',
      kind: 'do',
      ask: 'Keep the tables in the export',
      draft: null
    })
    expect(db.attribution.drafts.of(conversationId)).toEqual({
      lastTs: '1700000000.000100',
      kind: 'do',
      ask: 'Keep the tables in the export',
      draft: null
    })
    expect(db.attribution.drafts.madeSince(0)).toBe(2)
    expect(db.attribution.drafts.madeSince(2_000)).toBe(0)
    expect(db.attribution.drafts.kindOfSlack('C0ACME', '1700000000.000100')).toEqual({
      kind: 'do',
      drafted: false
    })
    expect(db.attribution.drafts.kindOfSlack('C0OTHER', '1700000000.000100')).toBeNull()
  })

  it('takes a talk read as for information off the owner, as a state guess, until the person writes again', () => {
    const { db, conversationId, said } = setup()
    expect(
      db.attribution.drafts.quiet(conversationId, '1700000000.000100', 'Bob says thanks')
    ).toBe(true)
    expect(db.listLedgerCards(0)).toEqual([])
    expect(db.attribution.drafts.quiet(conversationId, '1700000000.000100', 'again')).toBe(false)
    expect(db.attribution.records()).toContainEqual(
      expect.objectContaining({ field: 'state', guess: 'fyi', guess_how: 'model' })
    )
    said('1700000090.000100', 'And one more thing: the images?')
    expect(db.listLedgerCards(0).map((row) => row.id)).toEqual([conversationId])
  })

  it('leaves a talk alone when the person wrote again while the model read the thanks', () => {
    // Why (Codex 03.11): the newer message is a request; quieting the talk would hide it.
    const { db, conversationId, said } = setup()
    said('1700000090.000100', 'Also, can you send the images?')
    expect(db.attribution.drafts.quiet(conversationId, '1700000000.000100', 'thanks')).toBe(false)
    expect(db.listLedgerCards(0).map((row) => row.id)).toEqual([conversationId])
  })

  it('gives the promise finder the owner’s lines with what was said before them, once each', () => {
    const { db, conversationId, said } = setup()
    db.ingestLedgerSignal({
      key: KEY,
      ts: '1700000060.000100',
      at: 1_700_000_060_000,
      author: 'Me',
      authorId: 'U_ME',
      fromOwner: true,
      text: 'I will send it by Friday',
      link: 'https://acme.slack.com/archives/C0ACME/p1700000060000100',
      reader: 'slack-api',
      forOwner: false,
      project: null,
      title: 'Bob asks about the export'
    })
    said('1700000070.000100', 'No link on this one', true)
    const promises = db.attribution.promises
    const [first] = promises.ownLines(0, 0, 10)
    expect(promises.ownLines(0, 0, 10)).toEqual([
      expect.objectContaining({
        conversationId,
        text: 'I will send it by Friday',
        peer: 'Bob',
        peerId: 'U_BOB',
        peerText: 'Can the export keep the tables?'
      })
    ])
    expect(promises.lookedUpTo()).toBeNull()
    promises.looked(first?.row ?? 0)
    expect(promises.lookedUpTo()).toBe(first?.row)
    expect(promises.ownLines(first?.row ?? 0, 0, 10)).toEqual([])
    // Why (Codex 03.11): a line said earlier but read later — a thread read whole — still comes.
    db.ingestLedgerSignal({
      key: KEY,
      ts: '1700000030.000100',
      at: 1_700_000_030_000,
      author: 'Me',
      authorId: 'U_ME',
      fromOwner: true,
      text: 'Will check tonight',
      link: 'https://acme.slack.com/archives/C0ACME/p1700000030000100',
      reader: 'slack-api',
      forOwner: false,
      project: null,
      title: 'Bob asks about the export'
    })
    expect(promises.ownLines(first?.row ?? 0, 0, 10).map((line) => line.text)).toEqual([
      'Will check tonight'
    ])
    expect(promises.looksSince(0)).toBe(1)
  })

  it('reads the talk both ways, oldest first', () => {
    const { db, conversationId, said } = setup()
    said('1700000060.000100', 'Looking', true)
    expect(db.attribution.drafts.lines(conversationId)).toEqual([
      { fromOwner: false, author: 'Bob', text: 'Can the export keep the tables?' },
      { fromOwner: true, author: 'Me', text: 'Looking' }
    ])
  })

  it('goes on the card only while it answers the newest message', () => {
    const { db, conversationId, said } = setup()
    const draft = {
      lastTs: '1700000000.000100',
      kind: 'answer' as const,
      ask: 'Keep the tables?',
      draft: 'Bob, yes — today.'
    }
    const [row] = db.listLedgerCards(0)
    const card = row ? hqIntakeOfConversation(row, draft) : null
    expect(card).toMatchObject({ ask: 'Keep the tables?' })
    expect(card).not.toHaveProperty('replyDraft')
    expect(card ? hqIntakeBellItem(card) : null).toMatchObject({
      title: 'Bob: Keep the tables?',
      actions: [{ id: 'intake-open', label: 'To work' }],
      body: 'Bob: Can the export keep the tables?'
    })
    said('1700000090.000100', 'Also the images')
    const [later] = db.listLedgerCards(0)
    const stale = later ? hqIntakeOfConversation(later, draft) : null
    expect(stale?.ask).toBeUndefined()
    expect(conversationId).toBe(row?.id)
  })

  it('changes an open card in place when its draft arrives, without popping it again', () => {
    const { db, conversationId, tick } = setup()
    const [row] = db.listLedgerCards(0)
    const bare = row ? hqIntakeOfConversation(row) : null
    if (!row || !bare) {
      throw new Error('no card')
    }
    db.syncInboxKind('hq-intake', [
      { ...hqIntakeBellItem(bare), dedupeKey: hqIntakeBellItem(bare).dedupeKey ?? '' }
    ])
    const [first] = db.listInbox()
    db.markInboxRead(first?.id ?? '')
    tick(60_000)
    const drafted = hqIntakeOfConversation(row, {
      lastTs: '1700000000.000100',
      kind: 'answer',
      ask: 'Keep the tables?',
      draft: 'Yes.'
    })
    const input = drafted ? hqIntakeBellItem(drafted) : null
    expect(
      db.syncInboxKind('hq-intake', input ? [{ ...input, dedupeKey: input.dedupeKey ?? '' }] : [])
    ).toEqual({ raised: 0, closed: 0 })
    const [after] = db.listInbox()
    expect(after).toMatchObject({
      id: first?.id,
      title: 'Bob: Keep the tables?',
      createdAt: first?.createdAt
    })
    expect(after?.readAt).not.toBeNull()
    expect(conversationId).toBe(row.id)
  })

  it('makes a «To work» card for any Slack conversation, once, also one off his move', () => {
    // Why (owner 03.11): a thread card had only Done and Not needed; he copied the thread by hand.
    const { db, conversationId } = setup()
    db.attribution.drafts.quiet(conversationId, '1700000000.000100', 'read as news')
    const row = db.attribution.card(KEY)
    expect(row).toMatchObject({ id: conversationId, messages: [{ author: 'Bob' }] })
    const intake = row ? hqIntakeOfConversation(row) : null
    const first = intake ? db.addInboxItem(hqIntakeBellItem(intake)) : null
    const again = intake ? db.addInboxItem(hqIntakeBellItem(intake)) : null
    expect(first?.created).toBe(true)
    expect(again?.record.id).toBe(first?.record.id)
    expect(db.attribution.card('slack:C0NONE:1.1')).toBeNull()
  })
})
