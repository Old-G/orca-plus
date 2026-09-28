// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { HqPathSetting } from './HqPathSetting'

let container: HTMLDivElement
let root: Root
let pickFolderMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  pickFolderMock = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { repos: { pickFolder: pickFolderMock } }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  Reflect.deleteProperty(window, 'api')
})

function render(updateSettings: (updates: Partial<GlobalSettings>) => void, hqPath?: string) {
  act(() => {
    root.render(
      <HqPathSetting
        settings={{ ...getDefaultSettings('/tmp'), hqPath }}
        updateSettings={updateSettings}
      />
    )
  })
}

function input(): HTMLInputElement {
  const found = container.querySelector('input')
  if (!found) {
    throw new Error('HQ path input was not rendered')
  }
  return found
}

function type(value: string): void {
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function blur(): void {
  act(() => {
    input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

describe('HqPathSetting', () => {
  it('saves the trimmed path on blur', () => {
    const updateSettings = vi.fn()
    render(updateSettings)
    type('  /Users/me/HQ ')
    expect(updateSettings).not.toHaveBeenCalled()
    blur()
    expect(updateSettings).toHaveBeenCalledWith({ hqPath: '/Users/me/HQ' })
  })

  it('clearing the path turns the sync off', () => {
    const updateSettings = vi.fn()
    render(updateSettings, '/Users/me/HQ')
    type('')
    blur()
    expect(updateSettings).toHaveBeenCalledWith({ hqPath: null })
  })

  it('leaves settings alone when nothing changed', () => {
    const updateSettings = vi.fn()
    render(updateSettings, '/Users/me/HQ')
    blur()
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('saves a folder picked with Browse', async () => {
    const updateSettings = vi.fn()
    pickFolderMock.mockResolvedValue('/Users/me/HQ')
    render(updateSettings)
    const browse = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Browse'
    )
    await act(async () => {
      browse?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      browse?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ hqPath: '/Users/me/HQ' })
  })
})
