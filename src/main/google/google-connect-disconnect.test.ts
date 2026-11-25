// Custom build (google-disconnect-forget)
import { mkdtempSync, rmSync } from 'node:fs'
import type * as os from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The sign-ins under a temporary home, the trigger state beside a temporary data file.
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (actual) => ({
  ...(await actual<typeof os>()),
  homedir: () => home.dir
}))
vi.mock('../persistence/loading-store/user-data-path', () => ({
  getDataFile: () => `${home.dir}/orca-data.json`
}))

const { readGoogleAccount, saveGoogleAccount } = await import('./google-credential-store')
const { readGoogleTriggerState, writeGoogleTriggerState } = await import('./google-trigger-state')
const { GoogleConnect } = await import('./google-connect')

async function connect(email: string, connectedAt: number): Promise<void> {
  await saveGoogleAccount({
    email,
    client: { clientId: 'id', clientSecret: 'secret' },
    refreshToken: 'refresh',
    accessToken: 'access',
    expiresAt: connectedAt + 3_600_000,
    grantedScopes: [],
    status: 'connected',
    services: [],
    connectedAt
  })
}

beforeEach(() => {
  home.dir = mkdtempSync(join(tmpdir(), 'google-connect-disconnect-'))
})

afterEach(() => {
  rmSync(home.dir, { recursive: true, force: true })
})

describe('GoogleConnect.disconnect', () => {
  it("removes the account's sign-in and what the trigger checks kept of it", async () => {
    await connect('ann@acme.example', 1_000)
    await connect('bob@acme.example', 2_000)
    writeGoogleTriggerState({
      accounts: { 'ann@acme.example': { historyId: '41' }, 'bob@acme.example': { historyId: '7' } },
      listeners: { 'bot-1 ann@acme.example': 1_000, 'bot-1 bob@acme.example': 2_000 }
    })

    const google = new GoogleConnect({ http: vi.fn(), now: () => 0, client: async () => null })
    const result = await google.disconnect('Ann@acme.example', false)

    expect(result).toEqual({
      removed: 'ann@acme.example',
      revoked: null,
      defaultAccount: 'bob@acme.example'
    })
    expect(await readGoogleAccount('ann@acme.example')).toBeNull()
    expect(await readGoogleAccount('bob@acme.example')).not.toBeNull()
    expect(readGoogleTriggerState()).toEqual({
      accounts: { 'bob@acme.example': { historyId: '7' } },
      listeners: { 'bot-1 bob@acme.example': 2_000 }
    })
  })
})
