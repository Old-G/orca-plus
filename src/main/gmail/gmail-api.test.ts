import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  client: { clientId: 'old-id', clientSecret: 'old-secret' } as {
    clientId: string
    clientSecret: string
  } | null,
  saveGmailClient: vi.fn(),
  clearGmailRefreshToken: vi.fn()
}))

vi.mock('./gmail-credential-store', () => ({
  clearGmailRefreshToken: store.clearGmailRefreshToken,
  gmailAccount: () => 'owner@acme.example',
  hasGmailClient: () => store.client !== null,
  loadGmailClient: () => store.client,
  loadGmailRefreshToken: () => 'refresh-1',
  parseGmailClientFile: (text: string) => {
    const installed = JSON.parse(text).installed
    return { clientId: installed.client_id, clientSecret: installed.client_secret }
  },
  saveGmailClient: store.saveGmailClient,
  saveGmailRefreshToken: vi.fn()
}))

vi.mock('./gmail-oauth', () => ({
  authorizeGmail: vi.fn(),
  refreshGoogleToken: async () => ({ accessToken: 'access-1', expiresAt: Date.now() + 3_600_000 })
}))

import { importGmailClient, listGmailMessageIds } from './gmail-api'

function clientFile(id: string, secret: string): string {
  return JSON.stringify({ installed: { client_id: id, client_secret: secret } })
}

beforeEach(() => {
  store.client = { clientId: 'old-id', clientSecret: 'old-secret' }
  store.saveGmailClient.mockClear()
  store.clearGmailRefreshToken.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listGmailMessageIds', () => {
  it('follows the next page until the matches run out', async () => {
    const pages: Record<string, unknown> = {
      '': { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' },
      p2: { messages: [{ id: 'c' }] }
    }
    const fetchMock = vi.fn(async (url: URL) => {
      const body = pages[url.searchParams.get('pageToken') ?? '']
      return new Response(JSON.stringify(body), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await listGmailMessageIds('from:x', 500)).toEqual(['a', 'b', 'c'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('importGmailClient', () => {
  it('drops the sign-in when a different client replaces the one it was made with', () => {
    expect(importGmailClient(clientFile('new-id', 'new-secret'))).toEqual({ ok: true })
    expect(store.clearGmailRefreshToken).toHaveBeenCalledTimes(1)
  })

  it('keeps the sign-in when the same client is chosen again', () => {
    expect(importGmailClient(clientFile('old-id', 'old-secret'))).toEqual({ ok: true })
    expect(store.clearGmailRefreshToken).not.toHaveBeenCalled()
  })
})
