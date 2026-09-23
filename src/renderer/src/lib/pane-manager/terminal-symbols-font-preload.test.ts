import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ reset: vi.fn() }))
vi.mock('./pane-manager-registry', () => ({
  resetAndRefreshAllTerminalWebglAtlases: mocks.reset
}))

import { preloadTerminalSymbolsFont } from './terminal-symbols-font-preload'

function face(family: string) {
  const entry = {
    family,
    status: 'unloaded',
    load: vi.fn(async () => {
      entry.status = 'loaded'
    })
  }
  return entry
}

describe('preloadTerminalSymbolsFont', () => {
  it('loads the unloaded symbols face and rebuilds terminal atlases', async () => {
    mocks.reset.mockClear()
    const symbols = face('"Orca Nerd Font Symbols"')
    const other = face('Geist')
    preloadTerminalSymbolsFont([symbols, other], 1)
    await vi.waitFor(() => expect(mocks.reset).toHaveBeenCalledWith('symbols-font-loaded'))
    expect(symbols.load).toHaveBeenCalledTimes(1)
    expect(other.load).not.toHaveBeenCalled()
  })

  it('also loads a face that startup re-creates after the first load', async () => {
    mocks.reset.mockClear()
    const faces = [face('Orca Nerd Font Symbols')]
    preloadTerminalSymbolsFont(faces, 5)
    await vi.waitFor(() => expect(faces[0].status).toBe('loaded'))
    const recreated = face('Orca Nerd Font Symbols')
    faces.splice(0, 1, recreated)
    await vi.waitFor(() => expect(recreated.load).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(mocks.reset).toHaveBeenCalledTimes(2))
  })
})
