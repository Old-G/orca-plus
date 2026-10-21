// Custom build (hq-project-history): a workspace's past native chats for the panel beside its HQ chat
// — Agent Session History's list for the workspace, without automated or empty sessions, terminal
// transcripts (no chat to reopen) and chats already open as tabs.
import { useEffect, useMemo, useState } from 'react'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { structuredChatTabBySessionId } from '@/lib/structured-chat-tab-index'
import { useAppStore } from '@/store'
import { filterAiVaultSessions } from '../../../../../shared/ai-vault-session-filters'
import { AI_VAULT_AGENTS, type AiVaultSession } from '../../../../../shared/ai-vault-types'
import type { Tab } from '../../../../../shared/tab-types'
import { resolveAiVaultPanelSessionListRequest } from '../../right-sidebar/ai-vault-panel-session-list-request'
import { aiVaultSessionListArgs } from '../../right-sidebar/ai-vault-session-list-request'

export type HqHistoryChat = AiVaultSession & {
  structuredSession: NonNullable<AiVaultSession['structuredSession']>
}

function isNativeChat(session: AiVaultSession): session is HqHistoryChat {
  return Boolean(session.structuredSession) && !session.subagent
}

/** Newest first. */
export function hqProjectHistoryChats(
  sessions: readonly AiVaultSession[],
  workspacePaths: readonly string[],
  tabsByWorktree: Readonly<Record<string, readonly Tab[] | undefined>>
): HqHistoryChat[] {
  return filterAiVaultSessions(sessions, {
    query: '',
    agents: AI_VAULT_AGENTS,
    scope: 'workspace',
    sort: 'updated',
    activeWorktreePaths: workspacePaths,
    hideEmptySessions: true,
    hideAutomatedSessions: true
  })
    .filter(isNativeChat)
    .filter(
      ({ structuredSession: chat }) =>
        !structuredChatTabBySessionId(tabsByWorktree, chat.workspaceId, chat.sessionId)
    )
}

type Listed = {
  projectId: string
  paths: readonly string[]
  sessions: readonly AiVaultSession[]
}

// Why per project: moving between chats of one project (or its worktrees) kept blanking the list
// and refilling it, so it seemed to change under the owner; the last list stays until a new one lands.
const lastListed = new Map<string, Listed>()

/** Asks the host the panel's own way, so both share its cached list; again when the window
 *  regains focus, since the panel can stay open on one chat for hours. */
export function useHqProjectHistory(worktreeId: string, projectId: string): HqHistoryChat[] {
  const [listed, setListed] = useState<Listed | null>(() => lastListed.get(projectId) ?? null)
  const [focusCount, setFocusCount] = useState(0)
  useEffect(
    () => window.api.aiVault.onWindowFocused?.(() => setFocusCount((count) => count + 1)),
    []
  )
  useEffect(() => {
    const request = resolveAiVaultPanelSessionListRequest(useAppStore.getState(), worktreeId)
    // Why: no paths would scan every transcript on the host for a list this panel cannot show.
    if (request.scopePaths.length === 0) {
      return
    }
    let current = true
    window.api.aiVault
      .listSessions(aiVaultSessionListArgs(request, { requestToken: createBrowserUuid() }))
      .then((result) => {
        if (current && !result.cancelled) {
          const next = { projectId, paths: request.scopePaths, sessions: result.sessions }
          lastListed.set(projectId, next)
          setListed(next)
        }
      })
      .catch((error: unknown) => console.warn('[hq] project history failed:', error))
    return () => {
      current = false
    }
  }, [worktreeId, projectId, focusCount])
  const tabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const shown = listed?.projectId === projectId ? listed : (lastListed.get(projectId) ?? null)
  return useMemo(
    () => (shown ? hqProjectHistoryChats(shown.sessions, shown.paths, tabsByWorktree) : []),
    [shown, tabsByWorktree]
  )
}
