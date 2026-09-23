import { describe, expect, it } from 'vitest'
import { installedElectronCandidates } from '../orcad/orcad-browser-provider'

describe('orcad installed Electron candidates on macOS', () => {
  it('prefers an installed Orca+ over a stock Orca', () => {
    const candidates = installedElectronCandidates('darwin', '/Users/test', {})
    const orcaPlus = candidates.indexOf('/Applications/Orca Plus.app/Contents/MacOS/Orca Plus')
    const orca = candidates.indexOf('/Applications/Orca.app/Contents/MacOS/Orca')
    expect(orcaPlus).toBeGreaterThanOrEqual(0)
    expect(orcaPlus).toBeLessThan(orca)
    expect(candidates).toContain('/Users/test/Applications/Orca Plus.app/Contents/MacOS/Orca Plus')
  })
})
