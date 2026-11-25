// Custom build (google-disconnect-forget)
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])

vi.mock('./google-credential-store', () => ({
  hasGoogleAccount: async () => true,
  readGoogleAccount: async () => null,
  removeGoogleAccount: async (email: string) => {
    calls.push(`remove ${email}`)
  },
  listGoogleAccounts: async () => [],
  resolveGoogleClient: async () => null,
  resolveGoogleDefaultAccount: async () => null,
  saveGoogleAccount: async () => undefined,
  saveGoogleDefaultAccount: async () => '',
  saveImportedGoogleClient: async () => undefined
}))
vi.mock('./google-account-forget', () => ({
  forgetGoogleAccount: async (email: string) => {
    calls.push(`forget ${email}`)
  }
}))

const { GoogleConnect } = await import('./google-connect')

beforeEach(() => {
  calls.length = 0
})

describe('GoogleConnect.disconnect', () => {
  it('forgets what was kept from the account once its sign-in is removed', async () => {
    const connect = new GoogleConnect({ http: vi.fn(), now: () => 0, client: async () => null })
    const result = await connect.disconnect('Ann@acme.example', false)
    expect(result.removed).toBe('ann@acme.example')
    expect(calls).toEqual(['remove Ann@acme.example', 'forget Ann@acme.example'])
  })
})
