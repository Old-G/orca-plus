// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { CustomAppearanceSection } from './CustomAppearanceSection'

beforeEach(() => {
  Object.assign(window, {
    api: {
      customCss: {
        get: vi.fn(async () => ({ css: '', error: null })),
        onChanged: vi.fn(() => () => {}),
        openFile: vi.fn(),
        revealFile: vi.fn()
      }
    }
  })
})

afterEach(() => cleanup())

function sectionToggle(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('button[aria-controls="appearance-section-custom-appearance"]')
}

describe('CustomAppearanceSection', () => {
  it('starts collapsed and off, with custom.css hidden', () => {
    const { container } = render(
      <CustomAppearanceSection settings={getDefaultSettings('/tmp')} updateSettings={vi.fn()} />
    )
    expect(sectionToggle(container)?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('stock Orca look')
    expect(container.textContent).not.toContain('Open custom.css')
  })

  it('turns the whole block on with its switch', () => {
    const updateSettings = vi.fn()
    const { container } = render(
      <CustomAppearanceSection
        settings={getDefaultSettings('/tmp')}
        updateSettings={updateSettings}
      />
    )
    fireEvent.click(sectionToggle(container)!)
    fireEvent.click(container.querySelector('[role="switch"]')!)
    expect(updateSettings).toHaveBeenCalledWith({ customAppearanceEnabled: true })
  })

  it('shows custom.css inside the block once it is on', () => {
    const { container } = render(
      <CustomAppearanceSection
        settings={{ ...getDefaultSettings('/tmp'), customAppearanceEnabled: true }}
        updateSettings={vi.fn()}
      />
    )
    expect(sectionToggle(container)?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Custom CSS')
  })
})
