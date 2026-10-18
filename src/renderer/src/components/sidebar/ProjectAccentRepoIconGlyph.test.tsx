// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../../shared/constants'
import { projectAccentColor } from '../../../../shared/project-accent-color'

vi.mock('@/components/repo/repo-icon', () => ({
  RepoIconGlyph: ({ color }: { color?: string }) => <span data-color={color ?? ''} />
}))

import { ProjectAccentRepoIconGlyph } from './ProjectAccentRepoIconGlyph'

afterEach(() => {
  cleanup()
})

function shownColor(color: string): string | null {
  const { container } = render(
    <ProjectAccentRepoIconGlyph projectId="repo-1" repoIcon={null} color={color} />
  )
  return container.querySelector('span')?.getAttribute('data-color') ?? null
}

describe('ProjectAccentRepoIconGlyph', () => {
  it('shows the palette accent for a project on the neutral default', () => {
    expect(shownColor(DEFAULT_REPO_BADGE_COLOR)).toBe(projectAccentColor('repo-1'))
  })

  it('keeps a picked color', () => {
    expect(shownColor('#ef4444')).toBe('#ef4444')
  })
})
