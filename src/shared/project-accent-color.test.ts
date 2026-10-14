import { describe, expect, it } from 'vitest'
import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from './constants'
import { projectAccentColor } from './project-accent-color'

describe('projectAccentColor', () => {
  it('keeps a color picked for the project', () => {
    expect(projectAccentColor('repo-1', '#ef4444')).toBe('#ef4444')
  })

  it('gives a project left on the neutral default a stable palette color', () => {
    const color = projectAccentColor('repo-1', DEFAULT_REPO_BADGE_COLOR)
    expect(color).not.toBe(DEFAULT_REPO_BADGE_COLOR)
    expect(REPO_COLORS).toContain(color)
    expect(projectAccentColor('repo-1', null)).toBe(color)
    const spread = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => projectAccentColor(id))
    )
    expect(spread.size).toBeGreaterThan(3)
  })
})
