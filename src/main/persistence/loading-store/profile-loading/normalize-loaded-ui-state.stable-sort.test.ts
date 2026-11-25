// Custom build (stable-sidebar-order, owner 25.11): Orca+ moves an activity sort to Manual once.
import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../../shared/orca-profiles/constants'
import type { PersistedState } from '../../../../shared/orca-profiles/persisted-state-types'
import { normalizeLoadedUiState } from './normalize-loaded-ui-state'

function load(ui: Partial<PersistedState['ui']>): PersistedState['ui'] {
  const defaults = getDefaultPersistedState('/Users/me')
  const parsed = { ...defaults, ui: { ...defaults.ui, ...ui } } as PersistedState
  return normalizeLoadedUiState(parsed, defaults, defaults.onboarding, false, false, () => {})
}

describe('Orca+ stable sidebar sort', () => {
  it('moves Smart and Recent to Manual once, whichever upstream migration ran', () => {
    expect(load({ sortBy: 'recent' }).sortBy).toBe('manual')
    expect(load({ sortBy: 'recent', _sortBySmartMigrated: true }).sortBy).toBe('manual')
    expect(load({ sortBy: 'smart', _sortBySmartMigrated: true }).sortBy).toBe('manual')
    expect(load({ sortBy: 'name' }).sortBy).toBe('name')
  })

  it('keeps the sort the owner picks after the move, Smart included', () => {
    const moved = load({ sortBy: 'smart', _sortBySmartMigrated: true })
    expect(moved._orcaPlusStableSortMigrated).toBe(true)
    for (const sortBy of ['smart', 'recent', 'name', 'manual'] as const) {
      expect(load({ ...moved, sortBy }).sortBy).toBe(sortBy)
    }
  })
})
