import type { ClaudeIdeClientTerminal } from './claude-ide-client-terminal'

export type ClaudeIdeMentionCandidate = {
  connectedAt: number
  terminal: ClaudeIdeClientTerminal | null
}

/**
 * VS Code has one CLI per window; Orca has one per terminal. The mention goes to
 * the newest CLI running in the file's worktree, else to the newest CLI at all.
 */
export function chooseClaudeIdeMentionTarget<T extends ClaudeIdeMentionCandidate>(
  candidates: readonly T[],
  worktreeId: string | undefined
): T | null {
  const newestFirst = [...candidates].sort((a, b) => b.connectedAt - a.connectedAt)
  const inWorktree = worktreeId
    ? newestFirst.find((candidate) => candidate.terminal?.worktreeId === worktreeId)
    : undefined
  return inWorktree ?? newestFirst[0] ?? null
}
