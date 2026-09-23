import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { openWorkspaceEditorItem } from '@/store/slices/editor/tabs/workspace-editor-item'
import { detectLanguage } from '@/lib/language-detect'
import type { ClaudeIdeDiffOutcome } from '../../../../shared/claude-ide-bridge-types'
import { registerClaudeProposal, requiredString } from './claude-ide-diff-proposal-state'
import { openInForegroundWorktree, relativeToWorktree } from './claude-ide-open-file'
import { findOwningLocalWorktree, resolveClaudeIdePath } from './claude-ide-workspace'

// openDiff from the Claude CLI's edit permission prompt: the proposed file opens as a
// diff tab (disk on the left, editable proposal on the right). Accepting hands the
// right side back to the CLI, which writes the file itself; Orca never writes it.

async function readOriginal(filePath: string): Promise<string> {
  if (!(await window.api.fs.pathExists({ filePath }))) {
    return ''
  }
  const file = await window.api.fs.readFile({ filePath })
  if (file.isBinary) {
    throw new Error(`Cannot show a diff for binary file: ${filePath}`)
  }
  return file.content
}

export async function openClaudeIdeDiff(params: Record<string, unknown>): Promise<string> {
  const oldPath = resolveClaudeIdePath(requiredString(params, 'old_file_path'))
  const filePath = resolveClaudeIdePath(requiredString(params, 'new_file_path'))
  const proposedContent = requiredString(params, 'new_file_contents')
  const tabName = requiredString(params, 'tab_name')
  const worktree = findOwningLocalWorktree(filePath)
  if (!worktree) {
    // Why: an error lets the CLI keep its own terminal prompt for files outside Orca's workspaces.
    throw new Error(`File is outside the Orca workspaces: ${filePath}`)
  }
  const originalContent = await readOriginal(oldPath)

  const fileId = `${worktree.id}::diff::claude-proposal::${tabName}`
  const relativePath = relativeToWorktree(filePath, worktree.path)
  const outcome = new Promise<ClaudeIdeDiffOutcome>((settle) => {
    registerClaudeProposal({
      fileId,
      tabName,
      originalContent,
      proposedContent,
      latestContent: proposedContent,
      settle
    })
  })
  const newFile: OpenFile = {
    id: fileId,
    filePath,
    relativePath,
    worktreeId: worktree.id,
    language: detectLanguage(filePath),
    isDirty: false,
    mode: 'diff',
    diffSource: 'claude-proposal'
  }
  openInForegroundWorktree(worktree.id, () => {
    useAppStore.setState((s) => ({
      openFiles: [...s.openFiles.filter((file) => file.id !== fileId), newFile],
      activeFileId: fileId,
      activeTabType: 'editor',
      activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktree.id]: fileId },
      activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktree.id]: 'editor' }
    }))
    openWorkspaceEditorItem(useAppStore.getState(), fileId, worktree.id, relativePath, 'diff')
  })
  return JSON.stringify(await outcome)
}
