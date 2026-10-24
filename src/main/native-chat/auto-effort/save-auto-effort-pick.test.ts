import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { saveAutoEffortPick } from './save-auto-effort-pick'

function store(options: Record<string, string>) {
  let record = {
    sessionId: 's1',
    provider: 'claude',
    options,
    lease: { runtimeFence: 3, claimStatus: 'live', ownerProcess: 'p' },
    updatedAt: 0
  } as unknown as AgentSessionRecord
  return {
    getRecord: () => record,
    reviseSessionOptions: vi.fn(async (revise, args) => {
      record = revise(record, args)
      return record
    }),
    current: () => record
  }
}

describe('saveAutoEffortPick', () => {
  it("saves the picked effort as the chat's, so the composer shows it", async () => {
    const chat = store({ model: 'opus', effort: 'medium' })
    await saveAutoEffortPick(chat, 's1', { model: 'opus', effort: 'xhigh' }, vi.fn(), () => 9)
    expect(chat.current().options).toEqual({ model: 'opus', effort: 'xhigh' })
  })

  it('writes nothing when the chat already has that effort or nothing was picked', async () => {
    const chat = store({ model: 'opus', effort: 'high' })
    await saveAutoEffortPick(chat, 's1', { model: 'opus', effort: 'high' }, vi.fn())
    await saveAutoEffortPick(chat, 's1', { model: 'opus' }, vi.fn())
    expect(chat.reviseSessionOptions).not.toHaveBeenCalled()
  })

  it('logs a refused write instead of failing the send', async () => {
    const chat = store({ effort: 'medium' })
    chat.reviseSessionOptions.mockRejectedValueOnce(new Error('lease moved'))
    const warn = vi.fn()
    await saveAutoEffortPick(chat, 's1', { effort: 'high' }, warn)
    expect(warn).toHaveBeenCalledOnce()
  })
})
