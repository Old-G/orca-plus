import { describe, expect, it } from 'vitest'
import { createOrcaPlusBuildVersion } from './orca-plus-build-version.mjs'

const date = new Date(Date.UTC(2026, 8, 25, 19, 30))

describe('createOrcaPlusBuildVersion', () => {
  it('sits after the newest shipped upstream release, not at the stale package.json version', () => {
    expect(createOrcaPlusBuildVersion('1.4.197', ['v1.4.210', 'v1.4.211', 'v1.3.9'], date)).toBe(
      '1.4.212-plus.202609251930'
    )
  })

  it('keeps an unshipped release candidate as the version being worked toward', () => {
    expect(createOrcaPlusBuildVersion('1.4.197', ['v1.4.211', 'v1.4.212-rc.1'], date)).toBe(
      '1.4.212-plus.202609251930'
    )
  })

  it('falls back to package.json when no tag is known, and skips unrelated tags', () => {
    expect(createOrcaPlusBuildVersion('1.4.197', ['pr-5674-evidence'], date)).toBe(
      '1.4.197-plus.202609251930'
    )
  })
})
