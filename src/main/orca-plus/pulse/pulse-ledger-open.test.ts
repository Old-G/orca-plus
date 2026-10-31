import { afterEach, describe, expect, it } from 'vitest'
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

const MR = 'gitlab:acme/app!12'

function send(over: Partial<HqAgentSend>): HqAgentSend {
  return {
    key: MR,
    ts: 'note:1',
    at: tick + 1,
    text: 'Ann, please re-review',
    link: null,
    title: 'app !12',
    project: 'acme-app',
    sessionId: 'chat-old',
    call: { sessionId: null, toolUseId: null },
    ...over
  }
}

function chat(db: PulseDb, sessionId: string, address: string | null, parent: string | null) {
  db.noteSessions([
    {
      sessionId,
      address,
      agent: 'claude',
      worktreeId: null,
      workspace: 'acme',
      project: 'acme-app',
      state: 'working',
      contextPct: null,
      parentSessionId: parent,
      taskRef: null,
      at: tick
    }
  ])
}

describe('listOpenLedgerConversations', () => {
  it('lists the project’s open talks with what we said, what came back and the live chat holding it', () => {
    const db = openDb()
    const ann = db.upsertPerson({ name: 'Ann', slackUserId: 'U0ANN00001' })
    chat(db, 'chat-old', 'acme-app/t1', null)
    chat(db, 'chat-new', 'acme-app/t2', 'chat-old')
    db.recordAgentSend(send({}))
    db.addWaiting({
      direction: 'on-them',
      personId: ann.id,
      project: 'acme-app',
      title: 'Ann: re-review !12',
      source: 'gitlab',
      agentSessionId: 'chat-old'
    })
    db.recordAgentSend(
      send({ key: 'clickup:DEV-7', ts: 'comment:7', text: 'Report attached', project: 'other' })
    )
    const [mr, ...rest] = db.listOpenLedgerConversations('acme-app')
    expect(rest).toEqual([])
    expect(mr).toMatchObject({
      key: MR,
      state: 'wait',
      withWhom: 'Ann',
      lastOut: { text: 'Ann, please re-review' },
      lastIn: null,
      holder: { sessionId: 'chat-new', address: 'acme-app/t2' }
    })

    db.ingestLedgerSignal({
      key: MR,
      ts: 'todo:5',
      at: tick + 5,
      author: 'Ann',
      authorId: null,
      fromOwner: false,
      text: 'Looks good, one nit',
      link: null,
      reader: 'gitlab-todos',
      forOwner: true,
      project: null,
      title: 'app !12'
    })
    expect(db.listOpenLedgerConversations('ACME-APP')[0]).toMatchObject({
      state: 'you',
      lastIn: { text: 'Looks good, one nit' }
    })
  })

  it('leaves out closed talks and ones only for information', () => {
    const db = openDb()
    db.recordAgentSend(send({}))
    expect(db.listOpenLedgerConversations('acme-app')).toEqual([])
  })
})
