import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeFileClient from '@/runtime/runtime-file-client'
import type { TreeNode } from './file-explorer-types'
import {
  canWriteExplorerNodesToClipboard,
  matchPendingExplorerCut,
  planExplorerCutMoves,
  pruneNestedExplorerNodes,
  resetPendingExplorerCut,
  writeExplorerNodesToClipboard
} from './file-explorer-clipboard-cut-copy'
import { pasteClipboardFilesIntoExplorerFolder } from './file-explorer-clipboard-paste'
import {
  clearFileExplorerUndoHistory,
  fileExplorerHasUndo,
  redoFileExplorer,
  undoFileExplorer
} from './fileExplorerUndoRedo'

const mocks = vi.hoisted(() => ({
  importExternalPathsToRuntime: vi.fn(),
  deleteRuntimePath: vi.fn(),
  executeOpenEditorPathMove: vi.fn(),
  copyFileToOsClipboard: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))

vi.mock('@/runtime/runtime-file-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeFileClient>()),
  importExternalPathsToRuntime: mocks.importExternalPathsToRuntime,
  deleteRuntimePath: mocks.deleteRuntimePath
}))

vi.mock('@/lib/execute-open-editor-path-move', () => ({
  executeOpenEditorPathMove: mocks.executeOpenEditorPathMove
}))

vi.mock('./file-explorer-row-file-transfer', () => ({
  copyFileToOsClipboard: mocks.copyFileToOsClipboard
}))

vi.mock('./file-explorer-operation-owner', () => ({
  captureFileExplorerOperationGuard: () => ({
    assertCurrent: () => undefined,
    route: {
      settings: { activeRuntimeEnvironmentId: null },
      connectionId: undefined,
      expectedExecutionHostId: 'local'
    }
  })
}))

function node(path: string, isDirectory = false): TreeNode {
  return {
    name: path.split('/').pop() ?? path,
    path,
    relativePath: path.replace(/^\/repo\//, ''),
    isDirectory,
    depth: 0
  }
}

type UiApi = {
  readClipboardFile: ReturnType<typeof vi.fn>
  writeClipboardFiles: ReturnType<typeof vi.fn>
}

function installUiApi(ui: Partial<UiApi>): UiApi {
  const api: UiApi = {
    readClipboardFile: vi.fn().mockResolvedValue({ ok: true, filePaths: [] }),
    // Echo the paths back like main does for already-resolved local paths.
    writeClipboardFiles: vi.fn(async (filePaths: string[]) => ({ ok: true, filePaths })),
    ...ui
  }
  Reflect.set(globalThis, 'window', { api: { ui: api } })
  return api
}

function paste(destinationDir: string, refreshDir = vi.fn().mockResolvedValue(undefined)) {
  return pasteClipboardFilesIntoExplorerFolder({
    destinationDir,
    worktreeId: 'wt-1',
    worktreePath: '/repo',
    refreshDir,
    setSelectedPath: vi.fn()
  })
}

describe('file explorer cut / copy', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
    mocks.executeOpenEditorPathMove.mockResolvedValue(undefined)
    mocks.deleteRuntimePath.mockResolvedValue(undefined)
    resetPendingExplorerCut()
    clearFileExplorerUndoHistory()
  })

  it('prunes selected descendants of a selected folder', () => {
    const nodes = [node('/repo/src', true), node('/repo/src/a.ts'), node('/repo/srcx.ts')]
    expect(pruneNestedExplorerNodes(nodes).map((n) => n.path)).toEqual([
      '/repo/src',
      '/repo/srcx.ts'
    ])
  })

  it('plans no move into the same folder or a folder into itself', () => {
    expect(
      planExplorerCutMoves(['/repo/a.ts', '/repo/src', '/repo/lib/b.ts'], '/repo/src/deep')
    ).toEqual([
      { from: '/repo/a.ts', to: '/repo/src/deep/a.ts' },
      { from: '/repo/lib/b.ts', to: '/repo/src/deep/b.ts' }
    ])
    expect(planExplorerCutMoves(['/repo/src/a.ts'], '/repo/src')).toEqual([])
  })

  it('keeps SSH worktrees to the upstream single-file copy and no cut', () => {
    expect(canWriteExplorerNodesToClipboard([node('/r/a')], 'copy', 'ssh-1')).toBe(true)
    expect(canWriteExplorerNodesToClipboard([node('/r/a')], 'cut', 'ssh-1')).toBe(false)
    expect(canWriteExplorerNodesToClipboard([node('/r/d', true)], 'copy', 'ssh-1')).toBe(false)
    expect(canWriteExplorerNodesToClipboard([node('/r/a'), node('/r/b')], 'copy', 'ssh-1')).toBe(
      false
    )
    expect(canWriteExplorerNodesToClipboard([node('/r/a'), node('/r/b')], 'cut', null)).toBe(true)
    expect(canWriteExplorerNodesToClipboard([], 'copy', null)).toBe(false)
  })

  it('copies an SSH file through the staged single-file path', async () => {
    const ui = installUiApi({})
    await writeExplorerNodesToClipboard({
      nodes: [node('/r/a')],
      mode: 'copy',
      worktreeId: 'wt-1',
      connectionId: 'ssh-1'
    })
    expect(mocks.copyFileToOsClipboard).toHaveBeenCalledWith(node('/r/a'), 'ssh-1')
    expect(ui.writeClipboardFiles).not.toHaveBeenCalled()
  })

  it('cut + paste moves the files, and undo / redo move them back and forth', async () => {
    const ui = installUiApi({})
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/a.ts'), node('/repo/lib', true)],
      mode: 'cut',
      worktreeId: 'wt-1'
    })
    expect(ui.writeClipboardFiles).toHaveBeenCalledWith(['/repo/a.ts', '/repo/lib'])

    ui.readClipboardFile.mockResolvedValue({ ok: true, filePaths: ['/repo/lib', '/repo/a.ts'] })
    const refreshDir = vi.fn().mockResolvedValue(undefined)
    await paste('/repo/src', refreshDir)

    expect(mocks.importExternalPathsToRuntime).not.toHaveBeenCalled()
    const moves = () =>
      mocks.executeOpenEditorPathMove.mock.calls.map(([a]) => `${a.fromPath} -> ${a.toPath}`)
    expect(moves()).toEqual(['/repo/a.ts -> /repo/src/a.ts', '/repo/lib -> /repo/src/lib'])
    expect(refreshDir).toHaveBeenCalledWith('/repo/src')
    expect(refreshDir).toHaveBeenCalledWith('/repo')

    mocks.executeOpenEditorPathMove.mockClear()
    expect(await undoFileExplorer()).toBe(true)
    expect(moves()).toEqual(['/repo/src/lib -> /repo/lib', '/repo/src/a.ts -> /repo/a.ts'])

    mocks.executeOpenEditorPathMove.mockClear()
    expect(await redoFileExplorer()).toBe(true)
    expect(moves()).toEqual(['/repo/a.ts -> /repo/src/a.ts', '/repo/lib -> /repo/src/lib'])

    // The cut was consumed: pasting the same clipboard again copies.
    expect(matchPendingExplorerCut(['/repo/lib', '/repo/a.ts'], 'wt-1')).toBeNull()
  })

  it('a cut pasted back into its own folder does nothing and stays pending', async () => {
    const ui = installUiApi({})
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/src/a.ts')],
      mode: 'cut',
      worktreeId: 'wt-1'
    })
    ui.readClipboardFile.mockResolvedValue({ ok: true, filePaths: ['/repo/src/a.ts'] })
    await paste('/repo/src')
    expect(mocks.executeOpenEditorPathMove).not.toHaveBeenCalled()
    expect(mocks.importExternalPathsToRuntime).not.toHaveBeenCalled()
    expect(fileExplorerHasUndo()).toBe(false)
    expect(matchPendingExplorerCut(['/repo/src/a.ts'], 'wt-1')).toEqual(['/repo/src/a.ts'])
  })

  it('stops at the first failed move, keeps what moved undoable and reports the file', async () => {
    const ui = installUiApi({})
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/a.ts'), node('/repo/b.ts')],
      mode: 'cut',
      worktreeId: 'wt-1'
    })
    ui.readClipboardFile.mockResolvedValue({ ok: true, filePaths: ['/repo/a.ts', '/repo/b.ts'] })
    mocks.executeOpenEditorPathMove
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('destination exists'))
    await paste('/repo/src')
    expect(mocks.toastError).toHaveBeenCalledWith('destination exists')
    expect(fileExplorerHasUndo()).toBe(true)
  })

  it('treats a clipboard that no longer matches the cut as a copy', async () => {
    const ui = installUiApi({})
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/a.ts')],
      mode: 'cut',
      worktreeId: 'wt-1'
    })
    ui.readClipboardFile.mockResolvedValue({ ok: true, filePaths: ['/Users/me/Desktop/other.txt'] })
    mocks.importExternalPathsToRuntime.mockResolvedValue({ results: [] })
    await paste('/repo/src')
    expect(mocks.executeOpenEditorPathMove).not.toHaveBeenCalled()
    expect(mocks.importExternalPathsToRuntime).toHaveBeenCalled()
  })

  it('does not move a cut into another worktree', async () => {
    installUiApi({})
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/a.ts')],
      mode: 'cut',
      worktreeId: 'wt-2'
    })
    expect(matchPendingExplorerCut(['/repo/a.ts'], 'wt-1')).toBeNull()
    expect(matchPendingExplorerCut(['/repo/a.ts'], 'wt-2')).toEqual(['/repo/a.ts'])
  })

  it('a copy after a cut cancels the cut', async () => {
    installUiApi({})
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/a.ts')],
      mode: 'cut',
      worktreeId: 'wt-1'
    })
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/a.ts')],
      mode: 'copy',
      worktreeId: 'wt-1'
    })
    expect(matchPendingExplorerCut(['/repo/a.ts'], 'wt-1')).toBeNull()
  })

  it('reports a failed clipboard write and leaves no cut behind', async () => {
    installUiApi({ writeClipboardFiles: vi.fn().mockResolvedValue({ ok: false, reason: 'x' }) })
    await writeExplorerNodesToClipboard({
      nodes: [node('/repo/a.ts')],
      mode: 'cut',
      worktreeId: 'wt-1'
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Could not copy the files to the clipboard')
    expect(matchPendingExplorerCut(['/repo/a.ts'], 'wt-1')).toBeNull()
  })

  it('copy-paste is undoable: undo trashes what was pasted, redo re-imports it', async () => {
    const ui = installUiApi({})
    ui.readClipboardFile.mockResolvedValue({ ok: true, filePaths: ['/ext/a.txt', '/ext/dir'] })
    mocks.importExternalPathsToRuntime.mockResolvedValue({
      results: [
        {
          sourcePath: '/ext/a.txt',
          status: 'imported',
          destPath: '/repo/a.txt',
          kind: 'file',
          renamed: false
        },
        {
          sourcePath: '/ext/dir',
          status: 'imported',
          destPath: '/repo/dir',
          kind: 'directory',
          renamed: false
        }
      ]
    })
    await paste('/repo')
    expect(fileExplorerHasUndo()).toBe(true)

    await undoFileExplorer()
    expect(
      mocks.deleteRuntimePath.mock.calls.map(([, path, recursive]) => [path, recursive])
    ).toEqual([
      ['/repo/a.txt', false],
      ['/repo/dir', true]
    ])

    mocks.importExternalPathsToRuntime.mockClear()
    mocks.importExternalPathsToRuntime.mockResolvedValue({
      results: [
        {
          sourcePath: '/ext/a.txt',
          status: 'imported',
          destPath: '/repo/a 2.txt',
          kind: 'file',
          renamed: true
        }
      ]
    })
    await redoFileExplorer()
    expect(mocks.importExternalPathsToRuntime).toHaveBeenCalledWith(
      expect.anything(),
      ['/ext/a.txt', '/ext/dir'],
      '/repo',
      expect.anything()
    )

    // A second undo trashes what the redo actually created.
    mocks.deleteRuntimePath.mockClear()
    await undoFileExplorer()
    expect(mocks.deleteRuntimePath.mock.calls.map(([, path]) => path)).toEqual(['/repo/a 2.txt'])
  })

  it('records no undo when nothing was imported', async () => {
    const ui = installUiApi({})
    ui.readClipboardFile.mockResolvedValue({ ok: true, filePaths: ['/ext/a.txt'] })
    mocks.importExternalPathsToRuntime.mockResolvedValue({
      results: [{ sourcePath: '/ext/a.txt', status: 'failed', reason: 'boom' }]
    })
    await paste('/repo')
    expect(fileExplorerHasUndo()).toBe(false)
  })
})
