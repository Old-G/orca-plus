// @vitest-environment happy-dom

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { useAppStore } from '../store'

const mocks = vi.hoisted(() => ({ applySheet: vi.fn() }))

vi.mock('@/lib/custom-appearance/adopted-sheet-slot', () => ({
  createAdoptedSheetSlot: () => mocks.applySheet
}))

import { useCustomAppearanceBackground } from './use-custom-appearance-background'

const NAME = 'background-0b0c7a4e-1f2d-4c3b-9a8e-7d6c5b4a3f21.png'
const initialState = useAppStore.getState()

describe('useCustomAppearanceBackground', () => {
  const read = vi.fn(async () => new Uint8Array([1, 2, 3]))

  beforeEach(() => {
    mocks.applySheet.mockReset()
    read.mockClear()
    Object.assign(window, { api: { customAppearanceBackground: { read } } })
    URL.createObjectURL = vi.fn(() => 'blob:test/1')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  function setSettings(customAppearanceEnabled: boolean): void {
    useAppStore.setState({
      settings: {
        ...getDefaultSettings('/tmp'),
        customAppearanceEnabled,
        customAppearanceBackground: { fileName: NAME, opacity: 0.3, blur: 4 }
      }
    })
  }

  it('draws the stored image while Custom appearance is on', async () => {
    setSettings(true)
    renderHook(() => useCustomAppearanceBackground())
    await waitFor(() =>
      expect(mocks.applySheet).toHaveBeenLastCalledWith(
        document,
        expect.stringContaining('url("blob:test/1")')
      )
    )
    expect(read).toHaveBeenCalledWith(NAME)
    expect(mocks.applySheet.mock.lastCall?.[1]).toContain('filter: blur(4px)')
  })

  it('reads nothing and draws nothing while the block is off', () => {
    setSettings(false)
    renderHook(() => useCustomAppearanceBackground())
    expect(read).not.toHaveBeenCalled()
    expect(mocks.applySheet).not.toHaveBeenCalledWith(document, expect.any(String))
  })
})
