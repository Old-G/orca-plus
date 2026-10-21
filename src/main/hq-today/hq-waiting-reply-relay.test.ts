import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { relayHqWaitingReplies, type HqWaitingReplyRelayDeps } from './hq-waiting-reply-relay'

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const step of cleanup.splice(0)) {
    await step()
  }
})

async function setup() {
  const hq = await mkdtemp(join(tmpdir(), 'hq-waiting-'))
  // Why: the waiting is asked at 1_792_184_214 s, so the thread's earlier messages are not answers.
  let tick = 1_792_184_214_000
  let id = 0
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `w${++id}` })
  cleanup.push(async () => {
    db.close()
    await rm(hq, { recursive: true, force: true })
  })
  const ann = db.upsertPerson({ name: 'Петя' })
  let readsSlackItself = false
  const deps: HqWaitingReplyRelayDeps = {
    hqPath: () => hq,
    listOpen: () => db.listWaitings({ status: 'open' }),
    personName: (personId) => db.getPerson(personId)?.name ?? null,
    recordReply: (waitingId, reply) => db.recordWaitingReply(waitingId, reply),
    readsSlackItself: () => readsSlackItself
  }
  const writeReplies = async (replies: unknown[]): Promise<void> => {
    await mkdir(join(hq, 'slack-scout'), { recursive: true })
    await writeFile(join(hq, 'slack-scout', 'replies.json'), JSON.stringify({ replies }))
  }
  const setReadsSlackItself = (value: boolean): void => {
    readsSlackItself = value
  }
  return { hq, db, ann, deps, writeReplies, setReadsSlackItself }
}

describe('relayHqWaitingReplies', () => {
  it('lists Slack waitings for the scout and records a new answer without handing it on', async () => {
    const { hq, db, ann, deps, writeReplies } = await setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Export',
      personId: ann.id,
      source: 'slack',
      sourceRef: 'slack:C0AAAAAAAAA:1792184200.000100',
      agentSessionId: 'chat-1'
    })
    db.addWaiting({ direction: 'on-them', title: 'By hand', source: 'note' })
    await relayHqWaitingReplies(deps)
    const watch = JSON.parse(await readFile(join(hq, 'slack-scout', 'watch.json'), 'utf8'))
    expect(watch.waitings).toEqual([
      expect.objectContaining({ id: asked.id, channel: 'C0AAAAAAAAA', person: 'Петя' })
    ])

    await writeReplies([
      { waitingId: asked.id, ts: '1792184100.000100', author: 'Петя', text: 'before the question' }
    ])
    await relayHqWaitingReplies(deps)
    expect(db.getWaiting(asked.id)?.reply).toBeNull()

    await writeReplies([
      {
        waitingId: asked.id,
        ts: '1792184300.000100',
        author: 'Петя',
        text: 'Готово, лежит в папке'
      }
    ])
    await relayHqWaitingReplies(deps)
    await relayHqWaitingReplies(deps)
    expect(db.getWaiting(asked.id)).toMatchObject({
      reply: 'Готово, лежит в папке',
      replyDeliveredAt: null
    })
  })

  it('gives the scout nothing to watch while Orca+ reads Slack itself', async () => {
    const { hq, db, deps, setReadsSlackItself } = await setup()
    db.addWaiting({
      direction: 'on-them',
      title: 'Export',
      source: 'slack',
      sourceRef: 'slack:C0AAAAAAAAA:1792184200.000100'
    })
    setReadsSlackItself(true)
    await relayHqWaitingReplies(deps)
    const watch = JSON.parse(await readFile(join(hq, 'slack-scout', 'watch.json'), 'utf8'))
    expect(watch.waitings).toEqual([])
  })
})
