// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../../shared/constants'
import { projectAccentColor } from '../../../../shared/project-accent-color'

const mocks = vi.hoisted(() => ({ newView: true }))
vi.mock('@/lib/orca-plus-new-view', () => ({ useOrcaPlusNewView: () => mocks.newView }))
vi.mock('@/components/repo/repo-icon', () => ({
  RepoIconGlyph: ({ color }: { color?: string }) => <span data-color={color ?? ''} />
}))

import { ProjectAccentRepoIconGlyph } from './ProjectAccentRepoIconGlyph'

afterEach(() => {
  cleanup()
  mocks.newView = true
})

function shownColor(color: string): string | null {
  const { container } = render(
    <ProjectAccentRepoIconGlyph projectId="repo-1" repoIcon={null} color={color} />
  )
  return container.querySelector('span')?.getAttribute('data-color') ?? null
}

describe('ProjectAccentRepoIconGlyph', () => {
  it('shows the palette accent for a project on the neutral default under the new view', () => {
    expect(shownColor(DEFAULT_REPO_BADGE_COLOR)).toBe(projectAccentColor('repo-1'))
  })

  it('keeps a picked color, and the old look when the new view is off', () => {
    expect(shownColor('#ef4444')).toBe('#ef4444')
    cleanup()
    mocks.newView = false
    expect(shownColor(DEFAULT_REPO_BADGE_COLOR)).toBe(DEFAULT_REPO_BADGE_COLOR)
  })
})
