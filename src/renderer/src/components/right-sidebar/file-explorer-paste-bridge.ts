import { useEffect, useRef } from 'react'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { formatKeybindingList } from '../../../../shared/keybindings'
import type { FileExplorerOperationOwner, TreeNode } from './file-explorer-types'
import type { FileExplorerRowProjection } from './file-explorer-row-projection'
import {
  pasteClipboardFilesIntoExplorerFolder,
  resolveFileExplorerPasteDestination,
  shouldShowPasteFileAction
} from './file-explorer-clipboard-paste'
import {
  canWriteExplorerNodesToClipboard,
  writeExplorerNodesToClipboard,
  type ExplorerClipboardMode
} from './file-explorer-clipboard-cut-copy'
import { shouldIgnoreFileExplorerKeyTarget } from './useFileExplorerKeys'
import { keepFileExplorerFocus } from './file-explorer-focus-keeper'

// Why: on macOS the app menu's Paste item owns Cmd+V, so the renderer never sees the keydown —
// only the `paste` event it dispatches (verified with a live keydown/paste log). Listening for
// `paste` also covers Edit > Paste, Ctrl+V on Windows/Linux, and every keyboard layout. The same
// holds for Cmd+X / Cmd+C and the `cut` / `copy` events.
const EXPLORER_SHELL_SELECTOR = '[data-orca-explorer-shell]'

type PasteTarget = (destinationDir: string) => void

let activePasteTarget: PasteTarget | null = null

/** Context-menu entry point: pastes OS-clipboard files into `destinationDir` of the mounted explorer. */
export function requestFileExplorerPaste(destinationDir: string): void {
  activePasteTarget?.(destinationDir)
}

export function fileExplorerPasteShortcutLabel(): string {
  const platform = getShortcutPlatform()
  return formatKeybindingList(['Mod+V'], platform)
}

export function clipboardEventCarriesFiles(event: Pick<ClipboardEvent, 'clipboardData'>): boolean {
  const types = event.clipboardData?.types
  return types ? Array.from(types).includes('Files') : false
}

/**
 * Whether a clipboard event belongs to the explorer. The event targets the element holding the
 * DOM selection when there is one, which can be stale text elsewhere while a row has focus — so
 * explorer focus counts too. Text fields (inline rename, filter) keep native behaviour.
 */
export function isFileExplorerClipboardEvent(event: Pick<ClipboardEvent, 'target'>): boolean {
  const candidates = [event.target, document.activeElement]
  return candidates.some(
    (el) =>
      el instanceof Element &&
      el.closest(EXPLORER_SHELL_SELECTOR) !== null &&
      !shouldIgnoreFileExplorerKeyTarget(el)
  )
}

export function shouldHandleFileExplorerPasteEvent(event: ClipboardEvent): boolean {
  return isFileExplorerClipboardEvent(event) && clipboardEventCarriesFiles(event)
}

function focusedRowNode(rowProjection: FileExplorerRowProjection): TreeNode | null {
  const wrapper = document.activeElement?.closest<HTMLElement>('[data-index]')
  const raw = wrapper?.dataset.index
  return raw === undefined ? null : rowProjection.getRowAtIndex(Number(raw))
}

/** Same rule as Delete: a multi-selection acts as a whole, otherwise the focused row. */
export function resolveFileExplorerClipboardNodes(
  focused: TreeNode | null,
  selected: TreeNode[]
): TreeNode[] {
  if (selected.length > 1) {
    return selected
  }
  return focused ? [focused] : selected
}

export function useFileExplorerPasteTarget(params: {
  worktreePath: string | null
  activeWorktreeId: string | null
  connectionId?: string | null
  selectedNode: TreeNode | null
  selectedPaths: Set<string>
  rowProjection: FileExplorerRowProjection
  refreshDir: (dirPath: string) => Promise<void>
  setSelectedPath: (path: string | null) => void
  operationOwner?: FileExplorerOperationOwner
}): void {
  const paramsRef = useRef(params)
  paramsRef.current = params

  useEffect(() => {
    if (!shouldShowPasteFileAction()) {
      return
    }
    const paste: PasteTarget = (destinationDir) => {
      const p = paramsRef.current
      void keepFileExplorerFocus(() =>
        pasteClipboardFilesIntoExplorerFolder({
          destinationDir,
          worktreeId: p.activeWorktreeId,
          worktreePath: p.worktreePath,
          operationOwner: p.operationOwner,
          refreshDir: p.refreshDir,
          setSelectedPath: p.setSelectedPath
        })
      )
    }
    const onPaste = (event: ClipboardEvent): void => {
      if (!shouldHandleFileExplorerPasteEvent(event)) {
        return
      }
      const p = paramsRef.current
      const node = focusedRowNode(p.rowProjection) ?? p.selectedNode
      const destinationDir = resolveFileExplorerPasteDestination(node, p.worktreePath)
      if (!destinationDir) {
        return
      }
      event.preventDefault()
      paste(destinationDir)
    }
    const onCutOrCopy = (event: ClipboardEvent): void => {
      if (!isFileExplorerClipboardEvent(event)) {
        return
      }
      const mode: ExplorerClipboardMode = event.type === 'cut' ? 'cut' : 'copy'
      const p = paramsRef.current
      const nodes = resolveFileExplorerClipboardNodes(
        focusedRowNode(p.rowProjection) ?? p.selectedNode,
        p.rowProjection.getRowsByPaths(p.selectedPaths)
      )
      if (!canWriteExplorerNodesToClipboard(nodes, mode, p.connectionId)) {
        return
      }
      event.preventDefault()
      void writeExplorerNodesToClipboard({
        nodes,
        mode,
        worktreeId: p.activeWorktreeId,
        connectionId: p.connectionId
      })
    }
    activePasteTarget = paste
    document.addEventListener('paste', onPaste)
    document.addEventListener('cut', onCutOrCopy)
    document.addEventListener('copy', onCutOrCopy)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('cut', onCutOrCopy)
      document.removeEventListener('copy', onCutOrCopy)
      if (activePasteTarget === paste) {
        activePasteTarget = null
      }
    }
  }, [])
}
