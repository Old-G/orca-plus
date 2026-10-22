// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { OrcaPlusQuietHoursSetting } from './OrcaPlusQuietHoursSetting'

afterEach(cleanup)

function hourField(view: ReturnType<typeof render>, label: string): HTMLInputElement {
  const field = view.getByLabelText(label)
  if (!(field instanceof HTMLInputElement)) {
    throw new Error(`${label} is not an input`)
  }
  return field
}

function renderSetting(overrides: Partial<GlobalSettings> = {}) {
  const updateSettings = vi.fn()
  const view = render(
    <OrcaPlusQuietHoursSetting
      settings={{ ...getDefaultSettings('/tmp'), ...overrides }}
      updateSettings={updateSettings}
    />
  )
  return { updateSettings, view, toggle: view.getByRole('switch', { name: 'Quiet Hours' }) }
}

describe('OrcaPlusQuietHoursSetting', () => {
  it('reads unset as off and turns on with 21 to 9', () => {
    const { toggle, view, updateSettings } = renderSetting()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(view.queryByLabelText('From')).toBeNull()
    fireEvent.click(toggle)
    expect(updateSettings).toHaveBeenLastCalledWith({
      orcaPlusQuietHours: { start: 21, end: 9 }
    })
  })

  it('turns off as null', () => {
    const { toggle, updateSettings } = renderSetting({ orcaPlusQuietHours: { start: 21, end: 9 } })
    fireEvent.click(toggle)
    expect(updateSettings).toHaveBeenLastCalledWith({ orcaPlusQuietHours: null })
  })

  it('saves an edited hour on blur and wraps it into 0–23', () => {
    const { view, updateSettings } = renderSetting({ orcaPlusQuietHours: { start: 22, end: 8 } })
    const from = hourField(view, 'From')
    fireEvent.change(from, { target: { value: '23' } })
    fireEvent.blur(from)
    expect(updateSettings).toHaveBeenLastCalledWith({ orcaPlusQuietHours: { start: 23, end: 8 } })

    const to = hourField(view, 'To')
    fireEvent.change(to, { target: { value: '24' } })
    fireEvent.blur(to)
    expect(updateSettings).toHaveBeenLastCalledWith({ orcaPlusQuietHours: { start: 22, end: 0 } })
  })

  it('ignores an empty field', () => {
    const { view, updateSettings } = renderSetting({ orcaPlusQuietHours: { start: 22, end: 8 } })
    const from = hourField(view, 'From')
    fireEvent.change(from, { target: { value: '' } })
    fireEvent.blur(from)
    expect(updateSettings).not.toHaveBeenCalled()
    expect(from.value).toBe('22')
  })
})
