// Custom build (native-chat-titles): stores Claude's own conversation title on a native-chat tab.
import type { AiVaultSessionTitle } from '../../../../shared/ai-vault-session-title'
import type { AppState } from '../types'

/** The next unified-tab map with the title set on agent-session tab `tabId`, or null when unchanged. */
export function patchAgentSessionTabAiVaultTitle(
  unifiedTabsByWorktree: AppState['unifiedTabsByWorktree'],
  tabId: string,
  aiVaultTitle: AiVaultSessionTitle | null
): AppState['unifiedTabsByWorktree'] | null {
  for (const [worktreeId, tabs] of Object.entries(unifiedTabsByWorktree)) {
    const current = tabs.find((tab) => tab.id === tabId && tab.contentType === 'agent-session')
    if (!current) {
      continue
    }
    const stored = current.aiVaultTitle ?? null
    if (
      stored?.agent === aiVaultTitle?.agent &&
      stored?.sessionId === aiVaultTitle?.sessionId &&
      stored?.title === aiVaultTitle?.title
    ) {
      return null
    }
    return {
      ...unifiedTabsByWorktree,
      [worktreeId]: tabs.map((tab) => (tab === current ? { ...tab, aiVaultTitle } : tab))
    }
  }
  return null
}
