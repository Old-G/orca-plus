import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pasteClipboardFilesIntoExplorerFolder,
  resolveFileExplorerPasteDestination,
  shouldShowPasteFileAction
} from './file-explorer-clipboard-paste'
import type * as RuntimeFileClient from '@/runtime/runtime-file-client'

const { importExternalPathsToRuntimeMock, toastErrorMock } = vi.hoisted(() => ({
  importExternalPathsToRuntimeMock: vi.fn(),
  toastErrorMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, success: vi.fn() }
}))

vi.mock('@/runtime/runtime-file-client', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeFileClient>()
  return {
    ...actual,
    importExternalPathsToRuntime: importExternalPathsToRuntimeMock
  }
})

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

describe('file explorer clipboard paste', () => {
  beforeEach(() => {
    toastErrorMock.mockReset()
    importExternalPathsToRuntimeMock.mockReset()
    Reflect.deleteProperty(globalThis, '__ORCA_WEB_CLIENT__')
  })

  it('pastes a clipboard file into the selected folder and refreshes it', async () => {
    const readClipboardFile = vi.fn().mockResolvedValue({
      ok: true,
      filePaths: ['/other-project/SomeFile.ts']
    })
    const refreshDir = vi.fn().mockResolvedValue(undefined)
    const setSelectedPath = vi.fn()
    importExternalPathsToRuntimeMock.mockResolvedValue({
      results: [
        {
          sourcePath: '/other-project/SomeFile.ts',
          status: 'imported',
          destPath: '/repo/src/SomeFile.ts',
          kind: 'file',
          renamed: false
        }
      ]
    })
    Reflect.set(globalThis, 'window', { api: { ui: { readClipboardFile } } })

    await pasteClipboardFilesIntoExplorerFolder({
      destinationDir: '/repo/src',
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      refreshDir,
      setSelectedPath
    })

    expect(importExternalPathsToRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      }),
      ['/other-project/SomeFile.ts'],
      '/repo/src',
      expect.objectContaining({ assertCurrent: expect.any(Function) })
    )
    expect(refreshDir).toHaveBeenCalledWith('/repo/src')
    expect(setSelectedPath).toHaveBeenCalledWith('/repo/src/SomeFile.ts')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('is a no-op when the OS clipboard has no files', async () => {
    const readClipboardFile = vi.fn().mockResolvedValue({ ok: true, filePaths: [] })
    const refreshDir = vi.fn()
    Reflect.set(globalThis, 'window', { api: { ui: { readClipboardFile } } })

    await pasteClipboardFilesIntoExplorerFolder({
      destinationDir: '/repo/src',
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      refreshDir
    })

    expect(importExternalPathsToRuntimeMock).not.toHaveBeenCalled()
    expect(refreshDir).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('is a no-op when clipboard file read fails', async () => {
    const readClipboardFile = vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
    const refreshDir = vi.fn()
    Reflect.set(globalThis, 'window', { api: { ui: { readClipboardFile } } })

    await pasteClipboardFilesIntoExplorerFolder({
      destinationDir: '/repo/src',
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      refreshDir
    })

    expect(importExternalPathsToRuntimeMock).not.toHaveBeenCalled()
    expect(refreshDir).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('pastes into a file row parent and into the project root when nothing is selected', () => {
    expect(
      resolveFileExplorerPasteDestination(
        { path: '/repo/src/index.ts', isDirectory: false },
        '/repo'
      )
    ).toBe('/repo/src')
    expect(
      resolveFileExplorerPasteDestination({ path: '/repo/src', isDirectory: true }, '/repo')
    ).toBe('/repo/src')
    expect(resolveFileExplorerPasteDestination(null, '/repo')).toBe('/repo')
    expect(resolveFileExplorerPasteDestination(null, null)).toBeNull()
  })

  it('hides paste on the web client', () => {
    expect(shouldShowPasteFileAction()).toBe(true)
    Reflect.set(globalThis, '__ORCA_WEB_CLIENT__', true)
    expect(shouldShowPasteFileAction()).toBe(false)
  })
})
