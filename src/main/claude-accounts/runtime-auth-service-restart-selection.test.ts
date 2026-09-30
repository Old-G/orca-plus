import {
  cleanupRuntimeAuthTestState,
  createClaudeAccount,
  createClaudeCredentialsJson,
  createElectronMock,
  createKeychainMock,
  createManagedClaudeAuth,
  createOauthRefreshMock,
  createSettings,
  createStore,
  readManagedCredentialsForTest,
  resetRuntimeAuthTestState,
  testState
} from './runtime-auth-service-test-harness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from '../persistence'

vi.mock('electron', () => createElectronMock())

vi.mock('./oauth-refresh', () => createOauthRefreshMock())

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

vi.mock('./keychain', () => createKeychainMock())

// Custom build (claude-account-restart): after a restart the runtime may still hold another managed
// account's login (a live session of it refreshed the shared keychain); the selection must win.
function asStore(store: ReturnType<typeof createStore>): Store {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the service reads settings only through getSettings/updateSettings, which the harness store implements.
  return store as unknown as Store
}

describe('ClaudeRuntimeAuthService after a restart', () => {
  beforeEach(() => {
    resetRuntimeAuthTestState()
  })

  afterEach(() => {
    cleanupRuntimeAuthTestState()
  })

  function setUpRuntimeHeldByPersonal() {
    const runtimeCredentialsPath = join(testState.fakeHomeDir, '.claude', '.credentials.json')
    const personal = createClaudeCredentialsJson('user@example.com', 'personal', 'org-personal')
    const work = createClaudeCredentialsJson('user@example.com', 'work', 'org-work')
    const personalPath = createManagedClaudeAuth(
      testState.userDataDir,
      'acct-personal',
      personal,
      '{"accountUuid":"u-personal","emailAddress":"user@example.com","organizationUuid":"org-personal"}\n'
    )
    const workPath = createManagedClaudeAuth(
      testState.userDataDir,
      'acct-work',
      work,
      '{"accountUuid":"u-work","emailAddress":"user@example.com","organizationUuid":"org-work"}\n'
    )
    writeFileSync(runtimeCredentialsPath, personal, 'utf-8')
    testState.scopedKeychainCredentials = personal
    testState.legacyKeychainCredentials = personal
    writeFileSync(
      join(testState.fakeHomeDir, '.claude.json'),
      `${JSON.stringify({
        oauthAccount: {
          accountUuid: 'u-personal',
          emailAddress: 'user@example.com',
          organizationUuid: 'org-personal'
        }
      })}\n`,
      'utf-8'
    )
    const store = createStore(
      createSettings({
        claudeManagedAccounts: [
          createClaudeAccount('acct-personal', personalPath, { organizationUuid: 'org-personal' }),
          createClaudeAccount('acct-work', workPath, { organizationUuid: 'org-work' })
        ],
        activeClaudeManagedAccountId: 'acct-work'
      })
    )
    return { runtimeCredentialsPath, personal, work, personalPath, workPath, store }
  }

  it('materializes the selected account over another managed login while Claude is live', async () => {
    const { runtimeCredentialsPath, personal, work, personalPath, workPath, store } =
      setUpRuntimeHeldByPersonal()
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    markClaudePtySpawned('surviving-personal-session')
    try {
      const service = new ClaudeRuntimeAuthService(asStore(store))
      await service.syncForCurrentSelection()

      expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(work)
      expect(testState.scopedKeychainCredentials).toBe(work)
      expect(readManagedCredentialsForTest('acct-personal', personalPath)).toBe(personal)
      expect(readManagedCredentialsForTest('acct-work', workPath)).toBe(work)
    } finally {
      markClaudePtyExited('surviving-personal-session')
    }
  })

  it('materializes the selected account over another managed login with no live Claude', async () => {
    const { runtimeCredentialsPath, work, store } = setUpRuntimeHeldByPersonal()
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    const service = new ClaudeRuntimeAuthService(asStore(store))
    await service.syncForCurrentSelection()

    expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(work)
  })

  it('still preserves unknown runtime credentials while Claude is live', async () => {
    const { runtimeCredentialsPath, work, workPath, store } = setUpRuntimeHeldByPersonal()
    const stranger = createClaudeCredentialsJson('other@example.com', 'stranger', 'org-other')
    writeFileSync(runtimeCredentialsPath, stranger, 'utf-8')
    testState.scopedKeychainCredentials = stranger
    testState.legacyKeychainCredentials = stranger
    const { markClaudePtyExited, markClaudePtySpawned } = await import('./live-pty-gate')
    const { ClaudeRuntimeAuthService } = await import('./runtime-auth-service')
    markClaudePtySpawned('unknown-session')
    try {
      const service = new ClaudeRuntimeAuthService(asStore(store))
      await service.syncForCurrentSelection()

      expect(readFileSync(runtimeCredentialsPath, 'utf-8')).toBe(stranger)
      expect(readManagedCredentialsForTest('acct-work', workPath)).toBe(work)
    } finally {
      markClaudePtyExited('unknown-session')
    }
  })
})
