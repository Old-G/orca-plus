import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const configPath = require.resolve('../electron-builder.config.cjs')

/** Re-requires the config with ORCA_PLUS_PACKAGING set or unset, then restores env and cache. */
function configWith(orcaPlus) {
  const original = process.env.ORCA_PLUS_PACKAGING
  try {
    if (orcaPlus) {
      process.env.ORCA_PLUS_PACKAGING = '1'
    } else {
      delete process.env.ORCA_PLUS_PACKAGING
    }
    delete require.cache[configPath]
    return require('../electron-builder.config.cjs')
  } finally {
    if (original === undefined) {
      delete process.env.ORCA_PLUS_PACKAGING
    } else {
      process.env.ORCA_PLUS_PACKAGING = original
    }
    delete require.cache[configPath]
  }
}

const carriesHqSkills = (platform) => platform.extraResources.some((r) => r.to === 'hq-skills')

// Custom build (hq-bundled-skills): a packaged app syncs the HQ skills whenever the bundle is present.
describe('electron-builder HQ skills bundle', () => {
  it('ships the HQ skills only in an Orca+ package', () => {
    const stock = configWith(false)
    const orcaPlus = configWith(true)
    for (const platform of ['mac', 'linux', 'win']) {
      expect(carriesHqSkills(stock[platform])).toBe(false)
      expect(carriesHqSkills(orcaPlus[platform])).toBe(true)
    }
  })
})
