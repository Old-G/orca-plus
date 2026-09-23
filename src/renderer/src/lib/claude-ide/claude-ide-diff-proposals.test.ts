// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeFile = { id: string; diffSource?: string }

const mocks = vi.hoisted(() => ({ openWorkspaceEditorItem: vi.fn() }))

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create<{
    openFiles: FakeFile[]
    activeFileIdByWorktree: Record<string, string>
    activeTabTypeByWorktree: Record<string, string>
    closeFile: (id: string) => void
  }>((set) => ({
    openFiles: [],
    activeFileIdByWorktree: {},
    activeTabTypeByWorktree: {},
    closeFile: (id) => set((s) => ({ openFiles: s.openFiles.filter((file) => file.id !== id) }))
  }))
  return { useAppStore }
})
vi.mock('@/store/slices/editor/tabs/workspace-editor-item', () => ({
  openWorkspaceEditorItem: mocks.openWorkspaceEditorItem
}))
vi.mock('./claude-ide-open-file', () => ({
  relativeToWorktree: (filePath: string, worktreePath: string) =>
    filePath.slice(worktreePath.length + 1),
  openInForegroundWorktree: (_worktreeId: string, open: () => void) => open()
}))
vi.mock('./claude-ide-workspace', () => ({
  resolveClaudeIdePath: (path: string) => path,
  findOwningLocalWorktree: (path: string) =>
    path.startsWith('/repo/') ? { id: 'wt1', path: '/repo' } : undefined
}))

import { useAppStore } from '@/store'
import {
  acceptClaudeProposal,
  closeAllClaudeDiffTabs,
  closeClaudeDiffTab,
  loadClaudeProposalDiff,
  rejectClaudeProposal,
  updateClaudeProposalContent,
  watchClosedClaudeProposals
} from './claude-ide-diff-proposal-state'
import { openClaudeIdeDiff } from './claude-ide-diff-proposals'

const params = (tabName: string, filePath = '/repo/src/a.ts') => ({
  old_file_path: filePath,
  new_file_path: filePath,
  new_file_contents: 'proposed',
  tab_name: tabName
})

async function openProposal(tabName: string) {
  const reply = openClaudeIdeDiff(params(tabName))
  await vi.waitFor(() => expect(mocks.openWorkspaceEditorItem).toHaveBeenCalled())
  const fileId = useAppStore.getState().openFiles.at(-1)?.id ?? ''
  mocks.openWorkspaceEditorItem.mockClear()
  return { reply, fileId }
}

describe('claude-ide diff proposals', () => {
  beforeEach(() => {
    closeAllClaudeDiffTabs()
    useAppStore.setState({ openFiles: [] })
    mocks.openWorkspaceEditorItem.mockClear()
    Object.assign(window, {
      api: {
        fs: {
          pathExists: vi.fn(async () => true),
          readFile: vi.fn(async () => ({ content: 'on disk', isBinary: false }))
        }
      }
    })
  })

  it('opens a claude-proposal diff tab with disk on the left and the proposal on the right', async () => {
    const { fileId } = await openProposal('tab-a')
    expect(useAppStore.getState().openFiles.at(-1)).toMatchObject({
      diffSource: 'claude-proposal',
      mode: 'diff',
      relativePath: 'src/a.ts'
    })
    expect(await loadClaudeProposalDiff(fileId)).toMatchObject({
      originalContent: 'on disk',
      modifiedContent: 'proposed'
    })
  })

  it('accept hands back what the user left on the right and closes the tab', async () => {
    const { reply, fileId } = await openProposal('tab-a')
    updateClaudeProposalContent(fileId, 'proposed + user tweak')
    acceptClaudeProposal(fileId)
    expect(JSON.parse(await reply)).toEqual({ accepted: true, contents: 'proposed + user tweak' })
    expect(useAppStore.getState().openFiles).toEqual([])
  })

  it('reject, close_tab and closing the tab all answer rejected', async () => {
    const stop = watchClosedClaudeProposals()
    const first = await openProposal('tab-a')
    rejectClaudeProposal(first.fileId)
    expect(JSON.parse(await first.reply)).toEqual({ accepted: false })

    const second = await openProposal('tab-b')
    expect(closeClaudeDiffTab({ tab_name: 'tab-b' })).toBe('{}')
    expect(JSON.parse(await second.reply)).toEqual({ accepted: false })

    const third = await openProposal('tab-c')
    useAppStore.getState().closeFile(third.fileId)
    expect(JSON.parse(await third.reply)).toEqual({ accepted: false })
    stop()
  })

  it('treats a new file as empty on the left', async () => {
    Object.assign(window.api.fs, { pathExists: vi.fn(async () => false) })
    const { fileId } = await openProposal('tab-new')
    expect((await loadClaudeProposalDiff(fileId)).originalContent).toBe('')
  })

  it('refuses files outside Orca workspaces so the CLI keeps its terminal prompt', async () => {
    await expect(openClaudeIdeDiff(params('tab-x', '/elsewhere/a.ts'))).rejects.toThrow(
      /outside the Orca workspaces/
    )
    expect(useAppStore.getState().openFiles).toEqual([])
  })

  it('closeAllDiffTabs rejects every pending proposal and counts them', async () => {
    const a = await openProposal('tab-a')
    const b = await openProposal('tab-b')
    expect(closeAllClaudeDiffTabs()).toBe('{"closed":2}')
    expect(JSON.parse(await a.reply)).toEqual({ accepted: false })
    expect(JSON.parse(await b.reply)).toEqual({ accepted: false })
    await expect(loadClaudeProposalDiff(a.fileId)).rejects.toThrow(/no longer pending/)
  })
})
