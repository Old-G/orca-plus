// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { useAppStore } from '../store'

const mocks = vi.hoisted(() => ({ applySheet: vi.fn(), dark: true }))

vi.mock('@/lib/custom-appearance/adopted-sheet-slot', () => ({
  createAdoptedSheetSlot: () => mocks.applySheet
}))
vi.mock('@/components/editor/use-document-dark-theme', () => ({
  useDocumentDarkTheme: () => mocks.dark
}))

import { useCustomAppearanceTheme } from './use-custom-appearance-theme'

const THEME = {
  id: 'hub',
  label: 'Hub',
  base: 'vs-dark' as const,
  appTokens: { '--background': '#191d21' },
  terminal: {}
}
const initialState = useAppStore.getState()

function setSettings(customAppearanceEnabled: boolean): void {
  useAppStore.setState({
    settings: {
      ...getDefaultSettings('/tmp'),
      customAppearanceEnabled,
      customAppearanceTheme: THEME
    }
  })
}

describe('useCustomAppearanceTheme', () => {
  beforeEach(() => {
    mocks.applySheet.mockReset()
    mocks.dark = true
    // Why no vscodeThemes api: keeps the Monaco half out of this test.
    Object.assign(window, { api: {} })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('paints the theme tokens while the block is on and the mode matches', () => {
    setSettings(true)
    renderHook(() => useCustomAppearanceTheme())
    expect(mocks.applySheet).toHaveBeenLastCalledWith(
      document,
      ':root, .dark, .light {\n  --background: #191d21;\n}'
    )
  })

  it('stays stock when the block is off or the app is in the other mode', () => {
    setSettings(false)
    const { unmount } = renderHook(() => useCustomAppearanceTheme())
    expect(mocks.applySheet).toHaveBeenLastCalledWith(document, null)
    unmount()
    mocks.dark = false
    setSettings(true)
    renderHook(() => useCustomAppearanceTheme())
    expect(mocks.applySheet).toHaveBeenLastCalledWith(document, null)
  })
})
