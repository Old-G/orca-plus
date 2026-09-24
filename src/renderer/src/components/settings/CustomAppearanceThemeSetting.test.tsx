// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'

const mocks = vi.hoisted(() => ({ dark: true }))
vi.mock('@/components/editor/use-document-dark-theme', () => ({
  useDocumentDarkTheme: () => mocks.dark
}))

import { CustomAppearanceThemeSetting } from './CustomAppearanceThemeSetting'

const HUB = {
  id: 'hub-contrast-rainglow-36af1fd2',
  label: 'Hub Contrast (rainglow)',
  base: 'vs-dark' as const,
  colors: { 'editor.background': '#191d21' },
  tokenColors: [],
  origin: {
    kind: 'installed' as const,
    editor: 'cursor' as const,
    extensionId: 'daylerees.rainglow',
    version: '1.5.2'
  },
  importedAt: 0
}

const api = {
  listImported: vi.fn(async () => [
    { id: HUB.id, label: HUB.label, base: HUB.base, origin: HUB.origin }
  ]),
  listInstalled: vi.fn(async () => [
    {
      editor: 'cursor',
      extensionId: 'daylerees.rainglow',
      displayName: 'Rainglow',
      version: '1.5.2',
      themes: [{ label: HUB.label, base: 'vs-dark' }]
    }
  ]),
  openSource: vi.fn(async () => ({
    token: 't1',
    displayName: 'Rainglow',
    version: '1.5.2',
    themes: [{ label: HUB.label, base: 'vs-dark' }]
  })),
  importTheme: vi.fn(async () => ({
    id: HUB.id,
    label: HUB.label,
    base: HUB.base,
    origin: HUB.origin
  })),
  readImported: vi.fn(async () => HUB),
  removeImported: vi.fn(async () => {}),
  searchOpenVsx: vi.fn(async () => [])
}

beforeEach(() => {
  mocks.dark = true
  Object.values(api).forEach((fn) => fn.mockClear())
  Object.assign(window, { api: { vscodeThemes: api } })
})

afterEach(() => cleanup())

function buttonNamed(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  )
  if (!found) {
    throw new Error(`no button "${label}"`)
  }
  return found
}

describe('CustomAppearanceThemeSetting', () => {
  it('imports a theme from Cursor and switches Orca to its mode', async () => {
    const updateSettings = vi.fn()
    mocks.dark = false
    render(
      <CustomAppearanceThemeSetting
        settings={getDefaultSettings('/tmp')}
        updateSettings={updateSettings}
      />
    )
    fireEvent.click(buttonNamed('Choose…'))
    await waitFor(() => expect(document.body.textContent).toContain('Rainglow'))
    fireEvent.mouseDown(buttonNamed('Cursor & VS Code'))
    fireEvent.click(buttonNamed('Cursor & VS Code'))
    await waitFor(() => expect(buttonNamed('RainglowCursor · 1')).toBeTruthy())
    fireEvent.click(buttonNamed('RainglowCursor · 1'))
    await waitFor(() =>
      expect(api.openSource).toHaveBeenCalledWith({
        kind: 'installed',
        editor: 'cursor',
        extensionId: 'daylerees.rainglow'
      })
    )
    fireEvent.click(await waitFor(() => buttonNamed(`${HUB.label}Dark`)))
    await waitFor(() => expect(updateSettings).toHaveBeenCalled())
    expect(api.importTheme).toHaveBeenCalledWith('t1', HUB.label)
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'dark',
        customAppearanceTheme: expect.objectContaining({ id: HUB.id, base: 'vs-dark' })
      })
    )
  })

  it('explains a paused theme and offers the matching mode', () => {
    const updateSettings = vi.fn()
    mocks.dark = false
    render(
      <CustomAppearanceThemeSetting
        settings={{
          ...getDefaultSettings('/tmp'),
          customAppearanceTheme: {
            id: HUB.id,
            label: HUB.label,
            base: 'vs-dark',
            appTokens: {},
            terminal: {}
          }
        }}
        updateSettings={updateSettings}
      />
    )
    expect(document.body.textContent).toContain('it shows while Orca is dark')
    fireEvent.click(buttonNamed('Switch to Dark'))
    expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
    fireEvent.click(buttonNamed('Remove'))
    expect(updateSettings).toHaveBeenCalledWith({ customAppearanceTheme: null })
  })
})
