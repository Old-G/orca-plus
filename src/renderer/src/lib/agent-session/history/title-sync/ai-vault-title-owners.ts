// Custom build (native-chat-titles): tabs that can carry an AI Vault conversation title.
import type { AiVaultSessionTitle } from '../../../../../../shared/ai-vault/contracts/ai-vault-session-title'
import type { AppState } from '@/store/types'
import { keyedListsMatch } from '@/store/record-transitions/keyed-list-match'

export type AiVaultTitleOwner = {
  worktreeId: string
  aiVaultTitle?: AiVaultSessionTitle | null
  /** A terminal tab whose paired host publishes its session name (upstream's skipHostNamedTabs). */
  sessionTitleFromHost?: true
}

/** Terminal tabs by id, plus native-chat (agent-session) unified tabs, which have no terminal tab. */
export function collectAiVaultTitleOwners(
  state: Pick<AppState, 'tabsByWorktree' | 'unifiedTabsByWorktree'>
): Map<string, AiVaultTitleOwner> {
  const owners = new Map<string, AiVaultTitleOwner>()
  for (const tab of Object.values(state.tabsByWorktree).flat()) {
    owners.set(tab.id, tab)
  }
  for (const [id, tab] of collectAgentSessionTitleOwners(state)) {
    if (!owners.has(id)) {
      owners.set(id, tab)
    }
  }
  return owners
}

/** Only the native-chat (agent-session) unified tabs, for callers that already hold the terminal tabs. */
export function collectAgentSessionTitleOwners(
  state: Pick<AppState, 'unifiedTabsByWorktree'>
): Map<string, AiVaultTitleOwner> {
  const owners = new Map<string, AiVaultTitleOwner>()
  for (const tab of Object.values(state.unifiedTabsByWorktree ?? {}).flat()) {
    if (tab.contentType === 'agent-session') {
      owners.set(tab.id, tab)
    }
  }
  return owners
}

type UnifiedTab = NonNullable<AppState['unifiedTabsByWorktree'][string]>[number]

// Rows that are not native chats never matter here, so a terminal tab's title change keeps them equal.
function sameAgentSessionTitleOwner(left: UnifiedTab, right: UnifiedTab): boolean {
  const leftOwns = left.contentType === 'agent-session'
  const rightOwns = right.contentType === 'agent-session'
  if (!leftOwns || !rightOwns) {
    return leftOwns === rightOwns
  }
  return (
    left.id === right.id &&
    left.worktreeId === right.worktreeId &&
    left.aiVaultTitle?.agent === right.aiVaultTitle?.agent &&
    left.aiVaultTitle?.sessionId === right.aiVaultTitle?.sessionId &&
    left.aiVaultTitle?.title === right.aiVaultTitle?.title
  )
}

/** Whether native-chat tabs (their ids, worktrees and stored titles) are unchanged. */
export function agentSessionTitleOwnersEqual(
  current: Pick<AppState, 'unifiedTabsByWorktree'>,
  previous: Pick<AppState, 'unifiedTabsByWorktree'>
): boolean {
  // Why: a terminal title change replaces one workspace's bucket; comparing only replaced buckets
  // keeps it off every other workspace (upstream's title fan-out perf contract, #44954).
  return keyedListsMatch(
    current.unifiedTabsByWorktree,
    previous.unifiedTabsByWorktree,
    sameAgentSessionTitleOwner,
    'any'
  )
}
