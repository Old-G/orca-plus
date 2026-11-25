import { describe, expect, it } from 'vitest'
import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from './repository/appearance/repo-badge-color'
import { projectAccentColor, projectMarkColors } from './project-accent-color'

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

describe('projectMarkColors', () => {
  const repo = (id: string, addedAt: number, badgeColor = DEFAULT_REPO_BADGE_COLOR) => ({
    id,
    addedAt,
    badgeColor,
    displayName: 'orca',
    repoIcon: undefined
  })

  it('gives each project the color its sidebar mark shows', () => {
    const repos = [repo('a', 1), repo('b', 2), repo('c', 3, '#ef4444')]
    const colorOf = projectMarkColors(repos)
    // Same letters: Auto spreads them over distinct real colors, a picked one stays.
    expect(colorOf('a')).not.toBe(colorOf('b'))
    expect(colorOf('a')).not.toBe(DEFAULT_REPO_BADGE_COLOR)
    expect(colorOf('c')).toBe('#ef4444')
  })

  it('keeps the palette color for a folder that is not a project', () => {
    expect(projectMarkColors([])('folder-x')).toBe(projectAccentColor('folder-x'))
  })
})
