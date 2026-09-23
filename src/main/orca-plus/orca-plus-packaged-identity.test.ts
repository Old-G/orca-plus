import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyOrcaPlusPackagedProfile } from './orca-plus-packaged-identity'

describe('applyOrcaPlusPackagedProfile', () => {
  it('moves userData next to, not onto, the stock Orca profile and exports it', () => {
    const setPath = vi.fn()
    const env: NodeJS.ProcessEnv = {
      ORCA_USER_DATA_PATH: '/Users/me/Library/Application Support/orca'
    }
    const dir = applyOrcaPlusPackagedProfile(
      { getPath: () => '/Users/me/Library/Application Support', setPath },
      env
    )
    expect(dir).toBe(join('/Users/me/Library/Application Support', 'orca-plus'))
    expect(setPath).toHaveBeenCalledWith('userData', dir)
    expect(env.ORCA_USER_DATA_PATH).toBe(dir)
  })
})
