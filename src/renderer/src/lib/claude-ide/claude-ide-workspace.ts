import { useAppStore } from '@/store'
import { getAllWorktreesFromState } from '@/store/selectors'
import { getConnectionId } from '@/lib/connection-context'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ClaudeIdeWorkspaceFolder } from '../../../../shared/claude-ide-bridge-types'

// The IDE server only speaks for this machine's files: the Claude CLI that asks
// runs locally, so SSH and remote-runtime workspaces are not its workspace.

function isLocalWorktree(worktree: Worktree): boolean {
  return (
    (worktree.hostId === undefined || worktree.hostId === LOCAL_EXECUTION_HOST_ID) &&
    !worktree.runtimeOwnerEnvironmentId &&
    getConnectionId(worktree.id) === null
  )
}

export function listLocalWorktrees(): Worktree[] {
  return getAllWorktreesFromState(useAppStore.getState()).filter(
    (worktree) =>
      typeof worktree.path === 'string' && worktree.path.length > 0 && isLocalWorktree(worktree)
  )
}

export function activeLocalWorktree(): Worktree | undefined {
  const activeId = useAppStore.getState().activeWorktreeId
  return listLocalWorktrees().find((worktree) => worktree.id === activeId)
}

function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  )
}

/** Active worktree first: VS Code resolves relative paths against folder 0. */
export function claudeIdeWorkspaceFolders(): ClaudeIdeWorkspaceFolder[] {
  const active = activeLocalWorktree()
  const rest = listLocalWorktrees().filter((worktree) => worktree.id !== active?.id)
  return (active ? [active, ...rest] : rest).map((worktree) => ({
    name: baseName(worktree.path),
    path: worktree.path
  }))
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

function joinPath(root: string, relative: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relative.replace(/^[\\/]+/, '')}`
}

export function resolveClaudeIdePath(filePath: string): string {
  if (filePath.startsWith('file://')) {
    return decodeURIComponent(new URL(filePath).pathname)
  }
  if (isAbsolutePath(filePath)) {
    return filePath
  }
  const root = claudeIdeWorkspaceFolders()[0]?.path
  return root ? joinPath(root, filePath) : filePath
}

/** Innermost local worktree containing `filePath` (worktrees can nest inside a repo). */
export function findOwningLocalWorktree(filePath: string): Worktree | undefined {
  let best: Worktree | undefined
  for (const worktree of listLocalWorktrees()) {
    const root = worktree.path.replace(/[\\/]+$/, '')
    const inside =
      filePath === root || filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`)
    if (inside && (!best || root.length > best.path.length)) {
      best = worktree
    }
  }
  return best
}
