import {
  closeTestStores,
  testState,
  createStore,
  readDataFile,
  writeDataFile
} from '../persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDefaultPersistedState } from '../../../shared/orca-profiles/constants'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('../../ssh/config/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))
const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

vi.mock('../../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

// Custom build (clickup-tasks): upstream removed persistence-settings-ui-defaults.test.ts; our
// ClickUp rollout tests live here.
describe('Store: ClickUp on the Tasks page', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })
  it('adds ClickUp once to a profile saved before it existed', async () => {
    writeDataFile({
      ...getDefaultPersistedState(testState.dir),
      settings: {
        visibleTaskProviders: ['github', 'gitlab', 'linear', 'jira'],
        visibleTaskProvidersDefaultedForJira: true
      }
    })

    const store = await createStore()

    expect(store.getSettings().visibleTaskProviders).toEqual([
      'github',
      'gitlab',
      'linear',
      'jira',
      'clickup'
    ])
    store.flush()
    expect(readDataFile()).toMatchObject({
      settings: { visibleTaskProvidersDefaultedForClickUp: true }
    })
  })

  it('keeps ClickUp hidden after the user opted out', async () => {
    writeDataFile({
      ...getDefaultPersistedState(testState.dir),
      settings: {
        visibleTaskProviders: ['github', 'jira'],
        visibleTaskProvidersDefaultedForJira: true,
        visibleTaskProvidersDefaultedForClickUp: true
      }
    })

    const store = await createStore()

    expect(store.getSettings().visibleTaskProviders).toEqual(['github', 'jira'])
  })
})
