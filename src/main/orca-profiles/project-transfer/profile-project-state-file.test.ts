import { describe, expect, it } from 'vitest'
import { normalizeProfileProjectState } from './profile-project-state-file'

describe('normalizeProfileProjectState', () => {
  it('does not mark the stable-sort migration done for a saved profile without the flag', () => {
    const state = normalizeProfileProjectState({ ui: { sortBy: 'recent' } } as never)
    expect(state.ui._orcaPlusStableSortMigrated).toBeUndefined()
    expect(state.ui.sortBy).toBe('recent')
  })

  it('keeps the flag a saved profile already has', () => {
    const state = normalizeProfileProjectState({
      ui: { sortBy: 'manual', _orcaPlusStableSortMigrated: true }
    } as never)
    expect(state.ui._orcaPlusStableSortMigrated).toBe(true)
  })
})
