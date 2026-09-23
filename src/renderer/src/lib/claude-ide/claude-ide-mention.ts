import type { editor } from 'monaco-editor'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { ClaudeIdeMentionRequest } from '../../../../shared/claude-ide-bridge-types'
import { selectionOf } from './claude-ide-monaco-state'
import { findOwningLocalWorktree } from './claude-ide-workspace'

// Cmd/Ctrl+Alt+K, the VS Code extension's "Insert At-Mentioned": the CLI puts
// @file#Lx-y into its prompt, then focus moves to that CLI's terminal.

function focusTerminalTab(tabId: string, worktreeId: string | undefined): void {
  const store = useAppStore.getState()
  const owner =
    worktreeId ??
    Object.keys(store.unifiedTabsByWorktree).find((id) =>
      store.unifiedTabsByWorktree[id]?.some((tab) => tab.id === tabId)
    )
  if (!owner || !store.unifiedTabsByWorktree[owner]?.some((tab) => tab.id === tabId)) {
    return
  }
  if (store.activeWorktreeId !== owner) {
    store.setActiveWorktree(owner)
  }
  store.setActiveView('terminal')
  store.activateTab(tabId)
}

export async function mentionEditorSelectionInClaude(
  codeEditor: editor.ICodeEditor
): Promise<void> {
  const api = window.api.claudeIde
  const selection = selectionOf(codeEditor)
  if (!api || !selection) {
    return
  }
  const worktree = findOwningLocalWorktree(selection.filePath)
  const request: ClaudeIdeMentionRequest = {
    filePath: selection.filePath,
    ...(selection.selection.isEmpty
      ? {}
      : { lineStart: selection.selection.start.line, lineEnd: selection.selection.end.line }),
    ...(worktree ? { worktreeId: worktree.id } : {})
  }
  const result = await api.mention(request)
  if (!result.delivered) {
    toast(
      translate(
        'auto.components.claude.ide.mention.noSession',
        'No Claude Code session is connected to Orca'
      ),
      {
        description: translate(
          'auto.components.claude.ide.mention.noSessionHint',
          'Start claude in an Orca terminal, then mention again.'
        )
      }
    )
    return
  }
  if (result.tabId) {
    focusTerminalTab(result.tabId, result.worktreeId)
  }
}
