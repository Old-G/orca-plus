import React, { useEffect } from 'react'
import { ClipboardPaste, FilePlus, FolderPlus } from 'lucide-react'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/components/tab-bar/SortableTab'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { shouldShowPasteFileAction } from './file-explorer-clipboard-paste'
import {
  fileExplorerPasteShortcutLabel,
  requestFileExplorerPaste
} from './file-explorer-paste-bridge'

function stopRightButtonMenuSelection(event: React.PointerEvent): void {
  if (event.button !== 2) {
    return
  }
  // Why: the synthetic trigger sits at the cursor; the right-button release
  // can otherwise land on "New File" and select it immediately.
  event.preventDefault()
  event.stopPropagation()
}

export function FileExplorerBackgroundMenu({
  open,
  onOpenChange,
  point,
  worktreePath,
  onStartNew
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  point: { x: number; y: number }
  worktreePath: string
  onStartNew: (type: 'file' | 'folder', dir: string, depth: number) => void
}): React.JSX.Element {
  useEffect(() => {
    const close = (): void => onOpenChange(false)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, close)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, close)
  }, [onOpenChange])

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48"
        sideOffset={0}
        align="start"
        onPointerUpCapture={stopRightButtonMenuSelection}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onSelect={() => onStartNew('file', worktreePath, 0)}>
          <FilePlus />
          {translate(
            'auto.components.right.sidebar.FileExplorerBackgroundMenu.21fe46ed36',
            'New File'
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onStartNew('folder', worktreePath, 0)}>
          <FolderPlus />
          {translate(
            'auto.components.right.sidebar.FileExplorerBackgroundMenu.3b5e2dcb8d',
            'New Folder'
          )}
        </DropdownMenuItem>
        {shouldShowPasteFileAction() && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => requestFileExplorerPaste(worktreePath)}>
              <ClipboardPaste />
              {translate('auto.components.right.sidebar.FileExplorerBackgroundMenu.paste', 'Paste')}
              <DropdownMenuShortcut>{fileExplorerPasteShortcutLabel()}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
