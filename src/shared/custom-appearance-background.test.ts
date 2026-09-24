import { describe, expect, it } from 'vitest'
import {
  buildBackgroundOverlayCss,
  isBackgroundImageFileName,
  normalizeCustomAppearanceBackground
} from './custom-appearance-background'

const NAME = 'background-0b0c7a4e-1f2d-4c3b-9a8e-7d6c5b4a3f21.jpg'

describe('custom appearance background', () => {
  it('accepts only names the main process writes', () => {
    expect(isBackgroundImageFileName(NAME)).toBe(true)
    expect(isBackgroundImageFileName('../custom.css')).toBe(false)
    expect(isBackgroundImageFileName('background-x.jpg')).toBe(false)
    expect(isBackgroundImageFileName(`${NAME}.exe`)).toBe(false)
  })

  it('clamps opacity and blur, and fills defaults', () => {
    expect(normalizeCustomAppearanceBackground({ fileName: NAME, opacity: 3, blur: -2 })).toEqual({
      fileName: NAME,
      opacity: 1,
      blur: 0
    })
    expect(normalizeCustomAppearanceBackground({ fileName: NAME })).toEqual({
      fileName: NAME,
      opacity: 0.15,
      blur: 0
    })
    expect(normalizeCustomAppearanceBackground({ fileName: '/etc/passwd' })).toBeNull()
    expect(normalizeCustomAppearanceBackground(null)).toBeNull()
  })

  it('draws a click-through overlay, blurred only when asked', () => {
    const css = buildBackgroundOverlayCss('blob:orca/1', { fileName: NAME, opacity: 0.2, blur: 0 })
    expect(css).toContain('url("blob:orca/1")')
    expect(css).toContain('pointer-events: none')
    expect(css).toContain('opacity: 0.2')
    expect(css).not.toContain('blur(')
    expect(
      buildBackgroundOverlayCss('blob:x', { fileName: NAME, opacity: 0.2, blur: 6 })
    ).toContain('filter: blur(6px)')
  })
})
