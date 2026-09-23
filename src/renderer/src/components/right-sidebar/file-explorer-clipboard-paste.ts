import { toast } from 'sonner'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { dirname } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import { deleteRuntimePath, importExternalPathsToRuntime } from '@/runtime/runtime-file-client'
import type { ImportItemResult } from '../../../../shared/filesystem-import-result-types'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import { captureFileExplorerOperationGuard } from './file-explorer-operation-owner'
import { commitFileExplorerOp } from './fileExplorerUndoRedo'
import { keepFileExplorerFocus } from './file-explorer-focus-keeper'
import {
  matchPendingExplorerCut,
  moveCutPathsIntoExplorerFolder
} from './file-explorer-clipboard-cut-copy'

export function shouldShowPasteFileAction(): boolean {
  return Reflect.get(globalThis, '__ORCA_WEB_CLIENT__') !== true
}

export function resolveFileExplorerPasteDestination(
  selectedNode: { path: string; isDirectory: boolean } | null,
  worktreePath: string | null
): string | null {
  if (!worktreePath) {
    return null
  }
  if (!selectedNode) {
    return worktreePath
  }
  return selectedNode.isDirectory ? selectedNode.path : dirname(selectedNode.path)
}

export async function pasteClipboardFilesIntoExplorerFolder(args: {
  destinationDir: string
  worktreeId: string | null
  worktreePath: string | null
  operationOwner?: FileExplorerOperationOwner
  refreshDir: (dirPath: string) => Promise<void>
  setSelectedPath?: (path: string | null) => void
}): Promise<void> {
  if (!args.worktreeId || !args.worktreePath) {
    return
  }

  let filePaths: string[]
  try {
    const clipboard = await window.api.ui.readClipboardFile()
    filePaths = clipboard.ok ? clipboard.filePaths : []
  } catch {
    return
  }
  if (filePaths.length === 0) {
    return
  }

  const cutSources = matchPendingExplorerCut(filePaths, args.worktreeId)
  if (cutSources) {
    try {
      await moveCutPathsIntoExplorerFolder({
        sourcePaths: cutSources,
        destinationDir: args.destinationDir,
        worktreeId: args.worktreeId,
        worktreePath: args.worktreePath,
        operationOwner: args.operationOwner,
        refreshDir: args.refreshDir,
        setSelectedPath: args.setSelectedPath
      })
    } catch (error) {
      toast.error(extractIpcErrorMessage(error, 'Failed to move files.'))
    }
    return
  }

  try {
    const operationGuard = captureFileExplorerOperationGuard(args.worktreeId, args.operationOwner)
    operationGuard.assertCurrent()
    const fileContext = {
      settings: operationGuard.route.settings,
      worktreeId: args.worktreeId,
      worktreePath: args.worktreePath,
      connectionId: operationGuard.route.connectionId,
      expectedExecutionHostId: operationGuard.route.expectedExecutionHostId,
      expectedSshTargetId: operationGuard.route.expectedSshTargetId,
      expectedSshConnectionGeneration: operationGuard.route.expectedSshConnectionGeneration
    }
    const importInto = (sourcePaths: string[]): Promise<{ results: ImportItemResult[] }> =>
      importExternalPathsToRuntime(fileContext, sourcePaths, args.destinationDir, {
        assertCurrent: operationGuard.assertCurrent
      })
    const { results } = await importInto(filePaths)

    await args.refreshDir(args.destinationDir)

    const imported = results.filter((result) => result.status === 'imported')
    if (imported.length > 0) {
      // Undo trashes what the paste created (recoverable from the OS trash); redo
      // re-imports the same sources, which may pick fresh names if others now exist.
      let pasted = imported
      commitFileExplorerOp({
        undo: () =>
          keepFileExplorerFocus(async () => {
            operationGuard.assertCurrent()
            for (const item of pasted) {
              await deleteRuntimePath(fileContext, item.destPath, item.kind === 'directory')
            }
            await args.refreshDir(args.destinationDir)
          }),
        redo: () =>
          keepFileExplorerFocus(async () => {
            const again = await importInto(pasted.map((item) => item.sourcePath))
            pasted = again.results.filter((result) => result.status === 'imported')
            await args.refreshDir(args.destinationDir)
          })
      })
    }
    const skipped = results.filter((result) => result.status === 'skipped')
    const failed = results.filter((result) => result.status === 'failed')

    if (imported.length > 0) {
      args.setSelectedPath?.(imported[0].destPath)
    }

    if (failed.length > 0) {
      const noun = failed.length === 1 ? 'file' : 'files'
      toast.error(
        translate(
          'auto.components.right.sidebar.fileExplorerClipboardPaste.failed',
          'Failed to paste {{value0}} {{value1}}.',
          { value0: failed.length, value1: noun }
        )
      )
    } else if (skipped.length > 0 && imported.length === 0) {
      const noun = skipped.length === 1 ? 'file' : 'files'
      toast.error(
        translate(
          'auto.components.right.sidebar.fileExplorerClipboardPaste.skipped',
          'Skipped {{value0}} {{value1}}.',
          { value0: skipped.length, value1: noun }
        )
      )
    }
  } catch (error) {
    toast.error(extractIpcErrorMessage(error, 'Failed to paste files.'))
  }
}
