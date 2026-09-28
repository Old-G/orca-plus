import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTestStores, createStore, makeRepo, testState } from './persistence-test-harness'
import { onRepoRosterChanged } from './hq-roster-sync/repo-roster-events'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

describe('Store repo roster events', () => {
  let changes = 0
  let unsubscribe: () => void = () => {}

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-roster-'))
    changes = 0
    unsubscribe = onRepoRosterChanged(() => {
      changes += 1
    })
  })

  afterEach(async () => {
    unsubscribe()
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('fires when a project is added and when it is removed', () => {
    const store = createStore()
    store.addRepo(makeRepo({ id: 'repo-a' }))
    expect(changes).toBe(1)
    store.removeProject('repo-a')
    expect(changes).toBe(2)
  })

  it('stays quiet when removing a project Orca does not have', () => {
    const store = createStore()
    store.removeProject('missing')
    store.removeProjectForHost('missing', 'local')
    expect(changes).toBe(0)
  })
})
