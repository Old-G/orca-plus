import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PulseWaiting } from '../../shared/pulse-types'
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
  const deliver = vi.fn(async (_waiting: PulseWaiting, _prompt: string) => true)
  const deps: HqWaitingReplyRelayDeps = {
    hqPath: () => hq,
    listOpen: () => db.listWaitings({ status: 'open' }),
    personName: (personId) => db.getPerson(personId)?.name ?? null,
    recordReply: (waitingId, reply) => db.recordWaitingReply(waitingId, reply),
    markDelivered: (waitingId) => void db.markWaitingReplyDelivered(waitingId),
    deliver
  }
  const writeReplies = async (replies: unknown[]): Promise<void> => {
    await mkdir(join(hq, 'slack-scout'), { recursive: true })
    await writeFile(join(hq, 'slack-scout', 'replies.json'), JSON.stringify({ replies }))
  }
  return { hq, db, ann, deps, deliver, writeReplies }
}

describe('relayHqWaitingReplies', () => {
  it('lists Slack waitings for the scout and hands a new answer to the waiting chat once', async () => {
    const { hq, db, ann, deps, deliver, writeReplies } = await setup()
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
    expect(deliver).not.toHaveBeenCalled()

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
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver.mock.calls[0]?.[1]).toContain('Готово, лежит в папке')
    expect(db.getWaiting(asked.id)).toMatchObject({
      reply: 'Готово, лежит в папке',
      replyDeliveredAt: expect.any(Number)
    })
  })

  it('never hands an answer to a terminal pane, which may be a bare shell by now', async () => {
    const { db, deps, deliver, writeReplies } = await setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Logs',
      source: 'slack',
      sourceRef: 'slack:C0AAAAAAAAA:1792184200.000100',
      paneKey: 'tab-1:leaf-1'
    })
    await writeReplies([{ waitingId: asked.id, ts: '1792184300.000100', text: 'rm -rf ~' }])
    await relayHqWaitingReplies(deps)
    expect(deliver).not.toHaveBeenCalled()
    expect(db.getWaiting(asked.id)).toMatchObject({ reply: 'rm -rf ~', replyDeliveredAt: null })
  })

  it('keeps an answer the chat could not take and offers it again on the next pass', async () => {
    const { db, deps, deliver, writeReplies } = await setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Review',
      source: 'slack',
      sourceRef: 'slack:C0AAAAAAAAA:1792184200.000100',
      agentSessionId: 'chat-closed'
    })
    await writeReplies([{ waitingId: asked.id, ts: '1792184300.000100', text: 'LGTM' }])
    deliver.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('host gone'))
    await relayHqWaitingReplies(deps)
    await relayHqWaitingReplies(deps)
    expect(db.getWaiting(asked.id)?.replyDeliveredAt).toBeNull()
    await relayHqWaitingReplies(deps)
    expect(deliver).toHaveBeenCalledTimes(3)
    expect(db.getWaiting(asked.id)?.replyDeliveredAt).toEqual(expect.any(Number))
  })
})
