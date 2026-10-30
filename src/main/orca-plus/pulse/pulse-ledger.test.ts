import { afterEach, describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../../shared/hq-ledger'
import { hqPlaceKey } from '../../../shared/hq-ledger'
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
function signal(over: Partial<HqLedgerSignal>): HqLedgerSignal {
  return {
    key: THREAD,
    ts: '1700000001.000000',
    at: tick + 1,
    author: 'Ann',
    authorId: 'U_ANN',
    fromOwner: false,
    text: 'hi',
    link: null,
    reader: 'slack-mention',
    forOwner: true,
    project: null,
    title: 'Thread',
    ...over
  }
}

describe('hqPlaceKey', () => {
  it('reads Slack refs and permalinks, ClickUp, MRs', () => {
    expect(hqPlaceKey('slack:C0123HUBXY:1700000000.000100')).toBe(THREAD)
    expect(
      hqPlaceKey(
        'https://acme.slack.com/archives/C0123HUBXY/p1700000009000200?thread_ts=1700000000.000100&cid=C0123HUBXY'
      )
    ).toBe(THREAD)
    expect(hqPlaceKey('clickup:DEV-1:99')).toBe('clickup:DEV-1')
    expect(hqPlaceKey('https://gitlab.com/acme/hub/-/merge_requests/314')).toBe(
      'gitlab:acme/hub!314'
    )
    expect(hqPlaceKey('agent text')).toBeNull()
  })
})

describe('ledger ingest', () => {
  it('turns one thread read by three readers into one conversation (the 30.10 case)', () => {
    const db = openDb()
    const ann = db.upsertPerson({ name: 'Ann', slackUserId: 'U_ANN' })
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Mark 37 pairs',
      personId: ann.id,
      source: 'slack',
      sourceRef: THREAD,
      project: 'hub'
    })
    // the mention reader and the reply reader see the same message
    const first = db.ingestLedgerSignal(signal({ ts: '1700000001.000000', text: 'Page not found' }))
    const again = db.ingestLedgerSignal(signal({ ts: '1700000001.000000', reader: 'slack-reply' }))
    expect(first).toMatchObject({ step: 'place', added: true, waitingIds: [asked.id] })
    expect(again.added).toBe(false)
    // the scout saw a promise of the owner in the same thread
    const promise = db.addWaiting({
      direction: 'on-me',
      title: 'Fix the page',
      personId: ann.id,
      source: 'slack-promise',
      sourceRef:
        'https://acme.slack.com/archives/C0123HUBXY/p1700000002000000?thread_ts=1700000000.000100'
    })
    tick += 10
    db.ingestLedgerSignal(
      signal({
        ts: '1700000003.000000',
        fromOwner: true,
        author: 'Owner',
        authorId: 'U_ME',
        at: tick
      })
    )
    db.ingestLedgerSignal(signal({ ts: '1700000004.000000', text: 'Opened, thanks', at: tick + 1 }))

    const conversations = db.listLedgerConversations()
    expect(conversations).toHaveLength(1)
    expect(conversations[0]).toMatchObject({ project: 'hub', messages: 3, state: 'you' })
    expect(db.getWaiting(promise.id)?.status).toBe('resolved')
    expect(db.getWaiting(asked.id)?.status).toBe('open')
  })

  it('the owner writing in the thread hands the move back to them', () => {
    const db = openDb()
    const ann = db.upsertPerson({ name: 'Ann', slackUserId: 'U_ANN' })
    db.addWaiting({
      direction: 'on-them',
      title: 'q',
      personId: ann.id,
      source: 'slack',
      sourceRef: THREAD
    })
    db.ingestLedgerSignal(signal({}))
    db.ingestLedgerSignal(signal({ ts: '1700000005.000000', fromOwner: true, authorId: 'U_ME' }))
    expect(db.listLedgerConversations()[0]?.state).toBe('wait')
  })

  it('a DM answer goes to the one open request to its author; two requests ask which', () => {
    const db = openDb()
    const bob = db.upsertPerson({ name: 'Bob', slackUserId: 'U_BOB' })
    const only = db.addWaiting({
      direction: 'on-them',
      title: 'access?',
      personId: bob.id,
      source: 'slack',
      sourceRef: THREAD
    })
    const dm = signal({
      key: 'slack:D0123BOBXY:1700000009.000000',
      ts: '1700000009.000000',
      authorId: 'U_BOB',
      author: 'Bob'
    })
    expect(db.ingestLedgerSignal(dm)).toMatchObject({ step: 'person', waitingIds: [only.id] })

    const other = db.addWaiting({
      direction: 'on-them',
      title: 'keys for the replica',
      personId: bob.id,
      source: 'manual',
      allowDuplicate: true
    })
    const next = db.ingestLedgerSignal({
      ...dm,
      key: 'slack:D0123BOBXY:1700000010.000000',
      ts: '1700000010.000000',
      // Why two days on: a DM line of the same day joins that day's talk.
      at: tick + 2 * 24 * 60 * 60_000
    })
    expect(next.step).toBe('which')
    expect(next.waitingIds.sort()).toEqual([only.id, other.id].sort())
    expect(
      db.listLedgerConversations().find((c) => c.id === next.conversationId)?.stateWhy
    ).toContain('which:')
  })

  it('a merge mail is not taken for a person’s answer', () => {
    const db = openDb()
    const ann = db.upsertPerson({ name: 'Ann', slackUserId: 'U_ANN' })
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Mark pairs',
      personId: ann.id,
      source: 'slack',
      sourceRef: THREAD
    })
    const merged = db.ingestLedgerSignal(
      signal({
        key: 'gitlab:acme/hub!314',
        ts: 'mr-314',
        author: 'GitLab',
        authorId: 'gitlab',
        forOwner: false,
        reader: 'mr-watch'
      })
    )
    expect(merged).toMatchObject({ step: 'new', waitingIds: [] })
    expect(db.listLedgerConversations().find((c) => c.id === merged.conversationId)?.state).toBe(
      'fyi'
    )
    expect(db.listLedgerConversations()).toHaveLength(1)
    expect(db.getWaiting(asked.id)?.status).toBe('open')
  })

  it('a mention in a new channel thread is its own talk, not an answer to an older question', () => {
    const db = openDb()
    const ann = db.upsertPerson({ name: 'Ann', slackUserId: 'U_ANN' })
    db.addWaiting({
      direction: 'on-them',
      title: 'q1',
      personId: ann.id,
      source: 'slack',
      sourceRef: THREAD
    })
    db.addWaiting({
      direction: 'on-them',
      title: 'q2',
      personId: ann.id,
      source: 'manual',
      allowDuplicate: true
    })
    const fresh = db.ingestLedgerSignal(signal({ key: 'slack:C0123HUBXY:1700000500.000000' }))
    expect(fresh).toMatchObject({ step: 'new', waitingIds: [] })
  })

  it('a day of top-level DM lines is one talk', () => {
    const db = openDb()
    const first = db.ingestLedgerSignal(
      signal({ key: 'slack:D0123ANNXY:1700000100.000000', ts: '1700000100.000000' })
    )
    const second = db.ingestLedgerSignal(
      signal({
        key: 'slack:D0123ANNXY:1700000200.000000',
        ts: '1700000200.000000',
        at: tick + 3600_000
      })
    )
    expect(second.conversationId).toBe(first.conversationId)
  })

  it('keeps the change feed readable after a conversation moved', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({}))
    expect(db.listEventsSince(0).some((event) => event.entity === 'conversation')).toBe(true)
  })

  it('a DM that links another task asks instead of attaching', () => {
    const db = openDb()
    const bob = db.upsertPerson({ name: 'Bob', slackUserId: 'U_BOB' })
    db.addWaiting({
      direction: 'on-them',
      title: 'Is the MCP project yours?',
      personId: bob.id,
      source: 'slack',
      sourceRef: THREAD
    })
    const dm = signal({
      key: 'slack:D0123BOBXY:1700000020.000000',
      ts: '1700000020.000000',
      authorId: 'U_BOB',
      text: 'it is over here: https://app.clickup.com/t/1/DEV-18421'
    })
    expect(db.ingestLedgerSignal(dm).step).toBe('which')
  })

  it('a bare mention of another task does not stop the person step', () => {
    const db = openDb()
    const bob = db.upsertPerson({ name: 'Bob', slackUserId: 'U_BOB' })
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'SIP profile (DEV-18164)',
      personId: bob.id,
      source: 'slack',
      sourceRef: THREAD
    })
    const dm = signal({
      key: 'slack:D0123BOBXY:1700000030.000000',
      ts: '1700000030.000000',
      authorId: 'U_BOB',
      text: 'done, see also DEV-18250'
    })
    expect(db.ingestLedgerSignal(dm)).toMatchObject({ step: 'person', waitingIds: [asked.id] })
  })

  it('remembers the chat a conversation was taken into', () => {
    const db = openDb()
    const first = db.ingestLedgerSignal(signal({}))
    db.setConversationChat(THREAD, 'claude_s9')
    const row = db.listLedgerConversations().find((c) => c.id === first.conversationId)
    expect(row?.sessionId).toBe('claude_s9')
  })
})

describe('ledger guess and last word', () => {
  it('keeps a known project and a waiting state, marks the model’s project', () => {
    const db = openDb()
    const { conversationId } = db.ingestLedgerSignal(signal({ fromOwner: true }))
    expect(db.lastLedgerDirection(THREAD)).toBe('out')
    expect(db.lastLedgerDirection('slack:C0123HUBXY:1.1')).toBeNull()
    // Why: a guess raises only a talk whose newest message is someone else's.
    db.ingestLedgerSignal(signal({ ts: '1700000002.000000', forOwner: false, at: tick + 2 }))
    db.setLedgerGuess(conversationId, { project: 'acme', how: 'model', state: 'you', gist: 'Суть' })
    const [row] = db.listLedgerConversations()
    expect(row).toMatchObject({ project: 'acme', state: 'you', title: 'Суть' })
    // Why: the model reads others' text; it may not lower «your move».
    db.setLedgerGuess(conversationId, { project: 'other', how: 'named', state: 'fyi', gist: null })
    expect(db.listLedgerConversations()[0]).toMatchObject({
      project: 'acme',
      state: 'you',
      title: 'Суть'
    })
  })
})

describe('ledger cards', () => {
  it('lists Slack conversations on the owner with the people’s last messages, not the ones a chat waits in', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({ text: 'look', ts: '1700000001.000000' }))
    db.ingestLedgerSignal(signal({ fromOwner: true, ts: '1700000002.000000', forOwner: false }))
    db.ingestLedgerSignal(signal({ text: 'and this', ts: '1700000003.000000' }))
    const [card] = db.listLedgerCards(0)
    expect(card?.messages.map((m) => m.text)).toEqual(['look', 'and this'])
    const other = 'slack:C0123HUBXY:1700000100.000100'
    db.addWaiting({ direction: 'on-them', title: 'Asked Ann', source: 'slack', sourceRef: other })
    db.ingestLedgerSignal(signal({ key: other, ts: '1700000101.000000' }))
    expect(db.listLedgerCards(0).map((c) => c.key)).toEqual([THREAD])
  })

  it('a message handled from its card settles the conversation unless someone wrote after it', () => {
    const db = openDb()
    db.ingestLedgerSignal(signal({ ts: '1700000001.000000', at: tick + 1 }))
    db.settleLedgerMessage('1700000001.000000')
    expect(db.listLedgerCards(0)).toEqual([])
    db.ingestLedgerSignal(signal({ ts: '1700000002.000000', at: tick + 2 }))
    db.ingestLedgerSignal(signal({ ts: '1700000003.000000', at: tick + 3 }))
    db.settleLedgerMessage('1700000002.000000')
    expect(db.listLedgerCards(0).map((c) => c.key)).toEqual([THREAD])
  })
})
