import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { findOwningLocalWorktree } from '@/lib/claude-ide/claude-ide-workspace'

// Custom build (chat-edit-diff): an edit in chat opens as the file's working-tree diff in a Monaco
// tab, the same tab Source Control opens. Local git worktrees only: an SSH, remote or plain-folder
// workspace has no local git diff to show, so it gets no button.

export type ChatEditDiffTarget = { worktreeId: string; filePath: string; relativePath: string }

export function resolveChatEditDiffTarget(filePath: string): ChatEditDiffTarget | null {
  const worktree = findOwningLocalWorktree(filePath)
  const root = worktree?.path.replace(/[\\/]+$/, '')
  if (!worktree || !root || filePath.length <= root.length + 1) {
    return null
  }
  return { worktreeId: worktree.id, filePath, relativePath: filePath.slice(root.length + 1) }
}

export function openChatEditDiff(target: ChatEditDiffTarget): void {
  const store = useAppStore.getState()
  store.setActiveWorktree(target.worktreeId)
  store.setActiveView('terminal')
  store.openDiff(
    target.worktreeId,
    target.filePath,
    target.relativePath,
    detectLanguage(target.filePath),
    false
  )
  store.setActiveTabType('editor', target.worktreeId)
}
