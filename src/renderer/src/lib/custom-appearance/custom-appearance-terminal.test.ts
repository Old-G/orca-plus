import { describe, expect, it } from 'vitest'
import { withCustomAppearanceTerminalColors } from './custom-appearance-terminal'

const THEME = {
  id: 'hub',
  label: 'Hub',
  base: 'vs-dark' as const,
  appTokens: {},
  terminal: { red: '#e85362' }
}
const BASE = { background: '#000000', red: '#ff0000', blue: '#0000ff' }

describe('withCustomAppearanceTerminalColors', () => {
  it('layers the theme colors over the user terminal theme in its own mode', () => {
    expect(
      withCustomAppearanceTerminalColors(
        BASE,
        { customAppearanceEnabled: true, customAppearanceTheme: THEME },
        true
      )
    ).toEqual({ background: '#000000', red: '#e85362', blue: '#0000ff' })
  })

  it('leaves the terminal alone when off, in the other mode, or without a theme', () => {
    const on = { customAppearanceEnabled: true, customAppearanceTheme: THEME }
    expect(
      withCustomAppearanceTerminalColors(BASE, { ...on, customAppearanceEnabled: false }, true)
    ).toBe(BASE)
    expect(withCustomAppearanceTerminalColors(BASE, on, false)).toBe(BASE)
    expect(withCustomAppearanceTerminalColors(BASE, { customAppearanceEnabled: true }, true)).toBe(
      BASE
    )
    expect(withCustomAppearanceTerminalColors(null, on, true)).toBeNull()
  })
})
