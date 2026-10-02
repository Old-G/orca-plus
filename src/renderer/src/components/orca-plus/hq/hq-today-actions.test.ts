import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/agent-message-send', () => ({ sendMessageToAgent: vi.fn() }))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: vi.fn() }))
vi.mock('@/lib/running-agent-targets', () => ({
  deriveRunningAgentSendTargets: vi.fn(() => []),
  runningAgentMessageTarget: vi.fn()
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({ getExecutionHostIdForWorktree: vi.fn() }))

import { findHqWorktreeId } from './hq-today-actions'

function repo(id: string, path: string) {
  return { id, path }
}

function worktree(id: string, isMainWorktree: boolean, isArchived = false) {
  return { id, isMainWorktree, isArchived }
}

describe('findHqWorktreeId', () => {
  it('finds the HQ folder’s main checkout, ignoring a trailing slash', () => {
    const repos = [repo('shop', '/p/shop'), repo('hq', '/p/HQ')]
    expect(
      findHqWorktreeId('/p/HQ/', repos, {
        hq: [worktree('side', false), worktree('main', true)]
      })
    ).toBe('main')
  })

  it('is null when HQ is not set, not a project, or has only archived checkouts', () => {
    const repos = [repo('hq', '/p/HQ')]
    expect(findHqWorktreeId(null, repos, {})).toBeNull()
    expect(findHqWorktreeId('/p/other', repos, {})).toBeNull()
    expect(findHqWorktreeId('/p/HQ', repos, { hq: [worktree('old', true, true)] })).toBeNull()
  })
})
