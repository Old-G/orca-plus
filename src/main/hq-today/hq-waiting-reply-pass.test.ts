import { describe, expect, it, vi } from 'vitest'
import type { PulseWaiting } from '../../shared/pulse-types'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { passHqWaitingReply, skipHqWaitingReply } from './hq-waiting-reply-pass'

function setup(deliverResult = true) {
  let tick = 1_792_184_214_000
  let id = 0
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `w${++id}` })
  const deliver = vi.fn(async (_waiting: PulseWaiting, _prompt: string) => deliverResult)
  const deps = {
    listOpen: () => db.listWaitings({ status: 'open' }),
    deliver,
    markDelivered: (waitingId: string, replyTs: string | undefined) =>
      void db.markWaitingReplyDelivered(waitingId, replyTs)
  }
  const answered = (input: { agentSessionId?: string; paneKey?: string }) => {
    const waiting = db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      project: 'phone-bot',
      source: 'slack',
      sourceRef: 'slack:D0AAAAAAAAA:1792184200.000100',
      ...input
    })
    db.recordWaitingReply(waiting.id, { text: 'Sun–Thu 9–18', author: 'Anna', ts: '1792184300.1' })
    return waiting
  }
  return { db, deps, deliver, answered }
}

describe('passHqWaitingReply', () => {
  it('hands the answer to the chat once, naming the project, and marks it handled', async () => {
    const { db, deps, deliver, answered } = setup()
    const waiting = answered({ agentSessionId: 'chat-1' })
    expect(await passHqWaitingReply(deps, waiting.id)).toEqual({ ok: true })
    expect(deliver.mock.calls[0]?.[1]).toContain('Sun–Thu 9–18')
    expect(deliver.mock.calls[0]?.[1]).toContain('project phone-bot')
    expect(db.getWaiting(waiting.id)?.replyDeliveredAt).toEqual(expect.any(Number))
    expect(await passHqWaitingReply(deps, waiting.id)).toEqual({ ok: false, reason: 'gone' })
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('passes only the answer the owner saw; a newer one keeps its own card', async () => {
    const { db, deps, deliver, answered } = setup()
    const waiting = answered({ agentSessionId: 'chat-1' })
    db.recordWaitingReply(waiting.id, {
      text: 'Actually Sun–Fri',
      author: 'Anna',
      ts: '1792184400.1'
    })
    expect(await passHqWaitingReply(deps, waiting.id, '1792184300.1')).toEqual({
      ok: false,
      reason: 'gone'
    })
    skipHqWaitingReply(deps, waiting.id, '1792184300.1')
    expect(deliver).not.toHaveBeenCalled()
    expect(db.getWaiting(waiting.id)?.replyDeliveredAt).toBeNull()
  })

  it('sends one turn when Pass is pressed twice at once', async () => {
    const { deps, deliver, answered } = setup()
    const waiting = answered({ agentSessionId: 'chat-1' })
    const [first, second] = await Promise.all([
      passHqWaitingReply(deps, waiting.id, '1792184300.1'),
      passHqWaitingReply(deps, waiting.id, '1792184300.1')
    ])
    expect([first, second]).toEqual([{ ok: true }, { ok: false, reason: 'gone' }])
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('reports a closed chat and keeps the answer for another try', async () => {
    const { db, deps, answered } = setup(false)
    const waiting = answered({ agentSessionId: 'chat-closed' })
    expect(await passHqWaitingReply(deps, waiting.id)).toEqual({
      ok: false,
      reason: 'chat-closed'
    })
    expect(db.getWaiting(waiting.id)?.replyDeliveredAt).toBeNull()
  })

  it('never hands an answer to a terminal pane, which may be a bare shell by now', async () => {
    const { deps, deliver, answered } = setup()
    const waiting = answered({ paneKey: 'tab-1:leaf-1' })
    expect(await passHqWaitingReply(deps, waiting.id)).toEqual({ ok: false, reason: 'no-chat' })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('skips an answer without sending it anywhere', () => {
    const { db, deps, deliver, answered } = setup()
    const waiting = answered({ agentSessionId: 'chat-1' })
    skipHqWaitingReply(deps, waiting.id)
    expect(deliver).not.toHaveBeenCalled()
    expect(db.getWaiting(waiting.id)?.replyDeliveredAt).toEqual(expect.any(Number))
  })
})
