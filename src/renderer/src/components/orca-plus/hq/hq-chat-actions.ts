// Custom build (hq-chats): what the HQ chat screen does to the rest of the app — open a chat in
// its project, mark a finished one read, and remember which chat was open across visits.
import type { GitStatusEntry } from '../../../../../shared/git-status-types'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { revealDashboardAgent } from '../../dashboard/reveal-dashboard-agent'
import { hqChatTabId, type HqChatItem } from './hq-chat-list'
import { setShownHqChatTab } from './hq-chat-open'
import { closeHqScreen } from './hq-view'

let shownItem: HqChatItem | null = null

/** The chat HQ shows right now, for the Code mode to open; null on a pinned page. */
export function setShownHqChat(item: HqChatItem | null): void {
  shownItem = item
  setShownHqChatTab(item ? { worktreeId: item.worktreeId, tabId: hqChatTabId(item) } : null)
}

/** The Code mode: the project of the chat HQ shows, with that chat in front; else back to where HQ
 *  was opened from. */
export function switchHqToCode(): void {
  if (useAppStore.getState().activeView !== 'hq') {
    return
  }
  if (!shownItem || !openHqChatInProject(shownItem)) {
    closeHqScreen()
  }
}

/** Leaves HQ for the chat's workspace with the chat's own tab in front. */
export function openHqChatInProject(item: HqChatItem): boolean {
  if (item.kind === 'terminal') {
    const { card } = item
    return revealDashboardAgent({
      repoId: card.repoId,
      worktreeId: card.worktreeId,
      tabId: card.tabId,
      leafId: card.leafId,
      ...(card.executionHostId ? { executionHostId: card.executionHostId } : {})
    })
  }
  // Why: the workspace first — it switches the view back from HQ; the tab activation alone
  // only picks the tab inside a workspace that may not be shown.
  const executionHostId = item.tab.executionHostId ?? item.card?.executionHostId
  const revealed = activateAndRevealWorkspace(
    item.worktreeId,
    executionHostId ? { executionHostId } : undefined
  )
  if (revealed === false) {
    return false
  }
  return activateStructuredAgentSessionTab({ worktreeId: item.worktreeId, tabId: item.tab.id })
}

/** A finish the user has looked at in HQ stops counting as unread, as a visit to its tab does. */
export function acknowledgeHqChat(item: HqChatItem | undefined): void {
  acknowledgeHqChats(item ? [item] : [])
}

export function acknowledgeHqChats(items: readonly HqChatItem[]): void {
  const paneKeys = items.flatMap((item) => (item.card?.unseen ? [item.card.paneKey] : []))
  if (paneKeys.length > 0) {
    useAppStore.getState().acknowledgeAgents(paneKeys)
  }
}

/** Leaves HQ for the workspace with a changed file's diff open, as a Source Control click does. */
export function openHqChangeDiff(
  worktree: { id: string; path: string },
  entry: GitStatusEntry
): void {
  if (activateAndRevealWorkspace(worktree.id) === false) {
    return
  }
  const store = useAppStore.getState()
  const filePath = joinPath(worktree.path, entry.path)
  store.openDiff(
    worktree.id,
    filePath,
    entry.path,
    detectLanguage(entry.path),
    entry.area === 'staged'
  )
  store.setActiveTabType('editor', worktree.id)
}

/** Keeps a project's latest chats on view in HQ, or lets them go quiet with the rest again. */
export function setHqProjectKept(repoId: string, kept: boolean): void {
  const { settings, updateSettings } = useAppStore.getState()
  const current = settings?.hqKeptProjectIds ?? []
  const next = kept ? [...new Set([...current, repoId])] : current.filter((id) => id !== repoId)
  void updateSettings({ hqKeptProjectIds: next })
}
