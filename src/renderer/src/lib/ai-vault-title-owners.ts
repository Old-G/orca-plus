// Custom build (native-chat-titles): tabs that can carry an AI Vault conversation title.
import type { AiVaultSessionTitle } from '../../../shared/ai-vault-session-title'
import type { AppState } from '@/store/types'

export type AiVaultTitleOwner = {
  worktreeId: string
  aiVaultTitle?: AiVaultSessionTitle | null
}

/** Terminal tabs by id, plus native-chat (agent-session) unified tabs, which have no terminal tab. */
export function collectAiVaultTitleOwners(
  state: Pick<AppState, 'tabsByWorktree' | 'unifiedTabsByWorktree'>
): Map<string, AiVaultTitleOwner> {
  const owners = new Map<string, AiVaultTitleOwner>()
  for (const tab of Object.values(state.tabsByWorktree).flat()) {
    owners.set(tab.id, tab)
  }
  for (const tab of Object.values(state.unifiedTabsByWorktree ?? {}).flat()) {
    if (tab.contentType === 'agent-session' && !owners.has(tab.id)) {
      owners.set(tab.id, tab)
    }
  }
  return owners
}

function agentSessionTitleKeys(state: Pick<AppState, 'unifiedTabsByWorktree'>): string[] {
  return Object.values(state.unifiedTabsByWorktree ?? {})
    .flat()
    .filter((tab) => tab.contentType === 'agent-session')
    .map((tab) =>
      [
        tab.id,
        tab.worktreeId,
        tab.aiVaultTitle?.agent ?? '',
        tab.aiVaultTitle?.sessionId ?? '',
        tab.aiVaultTitle?.title ?? ''
      ].join('\0')
    )
}

/** Whether native-chat tabs (their ids, worktrees and stored titles) are unchanged. */
export function agentSessionTitleOwnersEqual(
  current: Pick<AppState, 'unifiedTabsByWorktree'>,
  previous: Pick<AppState, 'unifiedTabsByWorktree'>
): boolean {
  const left = agentSessionTitleKeys(current)
  const right = agentSessionTitleKeys(previous)
  return left.length === right.length && left.every((key, index) => key === right[index])
}
