import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

type Mocks = {
  worktree: { id: string; path: string } | undefined
  store: Record<'setActiveWorktree' | 'setActiveView' | 'openDiff' | 'setActiveTabType', Mock>
}

const mocks = vi.hoisted((): Mocks => ({
  worktree: undefined,
  store: {
    setActiveWorktree: vi.fn(),
    setActiveView: vi.fn(),
    openDiff: vi.fn(),
    setActiveTabType: vi.fn()
  }
}))

vi.mock('@/lib/claude-ide/claude-ide-workspace', () => ({
  findOwningLocalWorktree: () => mocks.worktree
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.store } }))

import { openChatEditDiff, resolveChatEditDiffTarget } from './native-chat-edit-diff'

afterEach(() => {
  vi.clearAllMocks()
  mocks.worktree = undefined
})

describe('opening a chat edit as a diff', () => {
  it('targets the file inside its local worktree', () => {
    mocks.worktree = { id: 'repo::/work/app', path: '/work/app/' }
    expect(resolveChatEditDiffTarget('/work/app/src/math.ts')).toEqual({
      worktreeId: 'repo::/work/app',
      filePath: '/work/app/src/math.ts',
      relativePath: 'src/math.ts'
    })
  })

  it('offers nothing outside a local worktree or for the worktree root', () => {
    expect(resolveChatEditDiffTarget('/elsewhere/a.ts')).toBeNull()
    mocks.worktree = { id: 'wt', path: '/work/app' }
    expect(resolveChatEditDiffTarget('/work/app')).toBeNull()
  })

  it('opens the working-tree diff in the worktree editor', () => {
    openChatEditDiff({
      worktreeId: 'wt',
      filePath: '/work/app/src/math.ts',
      relativePath: 'src/math.ts'
    })
    expect(mocks.store.setActiveWorktree).toHaveBeenCalledWith('wt')
    expect(mocks.store.openDiff).toHaveBeenCalledWith(
      'wt',
      '/work/app/src/math.ts',
      'src/math.ts',
      'typescript',
      false
    )
    expect(mocks.store.setActiveTabType).toHaveBeenCalledWith('editor', 'wt')
  })
})
