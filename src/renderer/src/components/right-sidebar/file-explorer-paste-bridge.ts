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
import { shouldIgnoreFileExplorerKeyTarget } from './useFileExplorerKeys'

// Why: on macOS the app menu's Paste item owns Cmd+V, so the renderer never sees the keydown —
// only the `paste` event it dispatches (verified with a live keydown/paste log). Listening for
// `paste` also covers Edit > Paste, Ctrl+V on Windows/Linux, and every keyboard layout.
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

export function shouldHandleFileExplorerPasteEvent(event: ClipboardEvent): boolean {
  const target = event.target
  if (!(target instanceof Element) || target.closest(EXPLORER_SHELL_SELECTOR) === null) {
    return false
  }
  if (shouldIgnoreFileExplorerKeyTarget(target)) {
    return false
  }
  return clipboardEventCarriesFiles(event)
}

function focusedRowNode(rowProjection: FileExplorerRowProjection): TreeNode | null {
  const wrapper = document.activeElement?.closest<HTMLElement>('[data-index]')
  const raw = wrapper?.dataset.index
  return raw === undefined ? null : rowProjection.getRowAtIndex(Number(raw))
}

export function useFileExplorerPasteTarget(params: {
  worktreePath: string | null
  activeWorktreeId: string | null
  selectedNode: TreeNode | null
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
      void pasteClipboardFilesIntoExplorerFolder({
        destinationDir,
        worktreeId: p.activeWorktreeId,
        worktreePath: p.worktreePath,
        operationOwner: p.operationOwner,
        refreshDir: p.refreshDir,
        setSelectedPath: p.setSelectedPath
      })
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
    activePasteTarget = paste
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('paste', onPaste)
      if (activePasteTarget === paste) {
        activePasteTarget = null
      }
    }
  }, [])
}
