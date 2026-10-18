// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

type Counts = { attention: number; working: number; done: number; idle: number }

const mocks = vi.hoisted(() => {
  const counts: Counts | undefined = { attention: 2, working: 1, done: 0, idle: 5 }
  return { counts }
})
vi.mock('./project-agent-counts', () => ({ useProjectAgentCounts: () => mocks.counts }))

import { ProjectAgentSummary } from './ProjectAgentSummary'

function renderSummary(): void {
  render(
    <TooltipProvider>
      <ProjectAgentSummary projectId="repo-1" />
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
  mocks.counts = { attention: 2, working: 1, done: 0, idle: 5 }
})

describe('ProjectAgentSummary', () => {
  it('counts agents that need the user, work, and finished unread; idle ones stay out', () => {
    renderSummary()
    expect(screen.getByLabelText('2 need you').textContent).toBe('2')
    expect(screen.getByLabelText('1 working').textContent).toBe('1')
    expect(screen.queryByLabelText(/done, unread/)).toBeNull()
  })

  it('shows nothing for a quiet project', () => {
    mocks.counts = { attention: 0, working: 0, done: 0, idle: 3 }
    renderSummary()
    expect(screen.queryByLabelText(/need you|working/)).toBeNull()
  })
})
