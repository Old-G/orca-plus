import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SlackRequestModule from './slack-request'

const { requestMock, storedMock, store } = vi.hoisted(() => {
  const store: { saved: string | null; load: () => string; has: () => boolean } = {
    saved: null,
    load: vi.fn(() => 'xoxp-saved'),
    has: vi.fn(() => true)
  }
  return { requestMock: vi.fn(), storedMock: vi.fn(), store }
})

vi.mock('./slack-request', async (importOriginal) => ({
  ...(await importOriginal<typeof SlackRequestModule>()),
  slackRequest: requestMock
}))
vi.mock('./slack-credential-store', () => ({ getStoredSlackMetadata: storedMock }))
vi.mock('./slack-reader-token-store', () => ({
  saveSlackReaderToken: (token: string) => {
    store.saved = token
  },
  clearSlackReaderToken: vi.fn(),
  hasSlackReaderToken: store.has,
  loadSlackReaderToken: store.load,
  getSlackReaderMetadata: () => ({
    teamId: 'T1',
    teamName: 'Acme',
    user: { id: 'UOWNER', name: 'owner' },
    updatedAt: ''
  })
}))

import { connectSlackReader, getSlackReaderStatus, withSlackReader } from './slack-reader'

const connected = {
  teamId: 'T1',
  teamName: 'Acme',
  owner: { id: 'UOWNER', name: 'owner' }
}

beforeEach(() => {
  requestMock.mockReset()
  storedMock.mockReturnValue(connected)
  store.saved = null
})

describe('connectSlackReader', () => {
  it('refuses a token of another user and saves nothing', async () => {
    requestMock.mockResolvedValueOnce({ team_id: 'T1', user_id: 'UBOB', user: 'bob', team: 'Acme' })
    const result = await connectSlackReader('xoxp-bob')
    expect(result).toMatchObject({ ok: false })
    expect(store.saved).toBeNull()
  })

  it('proves DM history and reactions can be read before saving the owner’s token', async () => {
    requestMock
      .mockResolvedValueOnce({ team_id: 'T1', user_id: 'UOWNER', user: 'owner', team: 'Acme' })
      .mockResolvedValueOnce({ channels: [{ id: 'D1' }] })
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({ items: [] })
    expect(await connectSlackReader('xoxp-owner')).toMatchObject({ ok: true })
    expect(requestMock).toHaveBeenCalledWith('xoxp-owner', 'conversations.history', {
      channel: 'D1',
      limit: 1
    })
    expect(requestMock).toHaveBeenLastCalledWith('xoxp-owner', 'reactions.list', { limit: 1 })
    expect(store.saved).toBe('xoxp-owner')
  })
})

describe('withSlackReader', () => {
  it('reports a saved token that can no longer be decrypted', async () => {
    vi.mocked(store.load).mockImplementationOnce(() => {
      throw new Error('decrypt failed')
    })
    await expect(withSlackReader(async () => 1)).rejects.toThrow('decrypt failed')
    expect(getSlackReaderStatus().error).toMatch(/can no longer be read/)
  })
})
