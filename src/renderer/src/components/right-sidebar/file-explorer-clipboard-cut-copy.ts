import { toast } from 'sonner'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { basename, dirname, joinPath } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import { executeOpenEditorPathMove } from '@/lib/execute-open-editor-path-move'
import type { FileExplorerOperationOwner, TreeNode } from './file-explorer-types'
import { captureFileExplorerOperationGuard } from './file-explorer-operation-owner'
import { commitFileExplorerOp } from './fileExplorerUndoRedo'
import { copyFileToOsClipboard } from './file-explorer-row-file-transfer'
import { keepFileExplorerFocus } from './file-explorer-focus-keeper'

/**
 * Cmd+C / Cmd+X in the File Explorer. Both put the selected files on the OS clipboard
 * (so Finder can paste them too). A cut also remembers what it cut: when the next
 * explorer paste finds exactly those files on the clipboard, in the same worktree,
 * it moves them instead of copying. Anything else on the clipboard — the user copied
 * something newer — falls back to a plain copy-paste.
 */
export type ExplorerClipboardMode = 'copy' | 'cut'

type PendingCutEntry = {
  /** Path the explorer/runtime knows the node by — what a move operates on. */
  explorerPath: string
  /** Path main wrote to the clipboard (authorized/resolved) — what a paste reads back. */
  clipboardPath: string
}

let pendingCut: { worktreeId: string; entries: PendingCutEntry[] } | null = null

export function resetPendingExplorerCut(): void {
  pendingCut = null
}

/** Drops nodes whose ancestor is also selected: copying/moving the folder covers them. */
export function pruneNestedExplorerNodes<T extends { path: string }>(nodes: T[]): T[] {
  const paths = nodes.map((node) => node.path)
  return nodes.filter(
    (node) =>
      !paths.some(
        (other) =>
          other !== node.path &&
          (node.path.startsWith(`${other}/`) || node.path.startsWith(`${other}\\`))
      )
  )
}

/**
 * Whether the explorer should claim this cut/copy. Remote (SSH) worktrees keep the
 * upstream "Copy file" contract — one concrete file, staged locally — and no cut:
 * a remote path cannot sit on the local clipboard for a later move.
 */
export function canWriteExplorerNodesToClipboard(
  nodes: TreeNode[],
  mode: ExplorerClipboardMode,
  connectionId?: string | null
): boolean {
  if (nodes.length === 0) {
    return false
  }
  if (!connectionId) {
    return true
  }
  return mode === 'copy' && nodes.length === 1 && !nodes[0].isDirectory
}

export async function writeExplorerNodesToClipboard(args: {
  nodes: TreeNode[]
  mode: ExplorerClipboardMode
  worktreeId: string | null
  connectionId?: string | null
}): Promise<void> {
  const nodes = pruneNestedExplorerNodes(args.nodes)
  // Why reset first: any new clipboard write supersedes an older cut, even a failed one.
  pendingCut = null
  if (args.connectionId) {
    await copyFileToOsClipboard(nodes[0], args.connectionId)
    return
  }
  const failureMessage = translate(
    'auto.components.right.sidebar.fileExplorerClipboardCutCopy.writeFailed',
    'Could not copy the files to the clipboard'
  )
  try {
    const result = await window.api.ui.writeClipboardFiles(nodes.map((node) => node.path))
    if (!result.ok || !result.filePaths || result.filePaths.length !== nodes.length) {
      toast.error(failureMessage)
      return
    }
    if (args.mode === 'cut' && args.worktreeId) {
      const clipboardPaths = result.filePaths
      pendingCut = {
        worktreeId: args.worktreeId,
        entries: nodes.map((node, i) => ({
          explorerPath: node.path,
          clipboardPath: clipboardPaths[i]
        }))
      }
    }
  } catch (error) {
    toast.error(extractIpcErrorMessage(error, failureMessage))
  }
}

/** The pending cut, if the clipboard still holds exactly the files it cut, in this worktree. */
export function matchPendingExplorerCut(
  clipboardPaths: string[],
  worktreeId: string | null
): string[] | null {
  if (!pendingCut || pendingCut.worktreeId !== worktreeId) {
    return null
  }
  const cut = new Set(pendingCut.entries.map((entry) => entry.clipboardPath))
  const onClipboard = new Set(clipboardPaths)
  if (cut.size !== onClipboard.size || [...cut].some((path) => !onClipboard.has(path))) {
    return null
  }
  return pendingCut.entries.map((entry) => entry.explorerPath)
}

type MoveStep = { from: string; to: string }

/** Moves that would change something: not into the same folder, not a folder into itself. */
export function planExplorerCutMoves(sourcePaths: string[], destinationDir: string): MoveStep[] {
  return sourcePaths
    .filter(
      (from) =>
        dirname(from) !== destinationDir &&
        destinationDir !== from &&
        !destinationDir.startsWith(`${from}/`) &&
        !destinationDir.startsWith(`${from}\\`)
    )
    .map((from) => ({ from, to: joinPath(destinationDir, basename(from)) }))
}

export async function moveCutPathsIntoExplorerFolder(args: {
  sourcePaths: string[]
  destinationDir: string
  worktreeId: string
  worktreePath: string
  operationOwner?: FileExplorerOperationOwner
  refreshDir: (dirPath: string) => Promise<void>
  setSelectedPath?: (path: string | null) => void
}): Promise<void> {
  const steps = planExplorerCutMoves(args.sourcePaths, args.destinationDir)
  if (steps.length === 0) {
    // Pasting a cut back where it came from is a no-op; keep the cut for the real target.
    return
  }
  const operationGuard = captureFileExplorerOperationGuard(args.worktreeId, args.operationOwner)
  const route = operationGuard.route
  const context = {
    settings: route.settings,
    worktreeId: args.worktreeId,
    worktreePath: args.worktreePath,
    connectionId: route.connectionId,
    expectedExecutionHostId: route.expectedExecutionHostId,
    expectedSshTargetId: route.expectedSshTargetId,
    expectedSshConnectionGeneration: route.expectedSshConnectionGeneration
  }
  const move = async (fromPath: string, toPath: string): Promise<void> => {
    operationGuard.assertCurrent()
    await executeOpenEditorPathMove({
      context,
      fromPath,
      toPath,
      worktreeId: args.worktreeId,
      worktreePath: args.worktreePath
    })
  }
  const touchedDirs = [...new Set([args.destinationDir, ...steps.map((s) => dirname(s.from))])]
  const refreshAll = (): Promise<unknown> => Promise.all(touchedDirs.map((d) => args.refreshDir(d)))

  const moved: MoveStep[] = []
  let failure: unknown = null
  for (const step of steps) {
    try {
      await move(step.from, step.to)
      moved.push(step)
    } catch (error) {
      failure = error
      break
    }
  }

  if (moved.length > 0) {
    // A cut is consumed by the paste that moved it; the files are no longer where it said.
    pendingCut = null
    commitFileExplorerOp({
      undo: () =>
        keepFileExplorerFocus(async () => {
          for (const step of moved.toReversed()) {
            await move(step.to, step.from)
          }
          await refreshAll()
        }),
      redo: () =>
        keepFileExplorerFocus(async () => {
          for (const step of moved) {
            await move(step.from, step.to)
          }
          await refreshAll()
        })
    })
    args.setSelectedPath?.(moved[0].to)
  }
  await refreshAll()

  if (failure !== null) {
    toast.error(
      extractIpcErrorMessage(
        failure,
        translate(
          'auto.components.right.sidebar.fileExplorerClipboardCutCopy.moveFailed',
          "Failed to move '{{value0}}'.",
          { value0: basename(steps[moved.length].from) }
        )
      )
    )
  }
}
