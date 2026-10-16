// Custom build (hq-history): opening a History row in HQ — the chat itself while its tab is open, a
// closed native chat brought back from its record first. HQ stays in front either way.
import {
  refreshStructuredSessionTabs,
  revealStructuredSession,
  structuredSessionOpenFeedback
} from '@/lib/activate-ai-vault-structured-session'
import { useAppStore } from '@/store'
import type { Tab } from '../../../../../shared/tab-types'
import type { HqHistoryEntry } from '../../../../../shared/hq-chat-history'
import { hqChatKey } from './hq-chat-list'
import { openHqChat } from './hq-chat-open'

export function isHqHistoryTabOpen(
  entry: Pick<HqHistoryEntry, 'worktreeId' | 'tabId'>,
  tabsByWorktree: Record<string, Tab[]>
): boolean {
  const { worktreeId, tabId } = entry
  return Boolean(worktreeId && tabId && tabsByWorktree[worktreeId]?.some((t) => t.id === tabId))
}

/** A closed terminal agent has no record to reopen; only native chats come back. */
export function canOpenHqHistoryEntry(
  entry: HqHistoryEntry,
  tabsByWorktree: Record<string, Tab[]>
): boolean {
  return isHqHistoryTabOpen(entry, tabsByWorktree) || Boolean(entry.worktreeId && entry.sessionId)
}

function openIfListed(entry: HqHistoryEntry): boolean {
  if (!entry.worktreeId || !entry.tabId) {
    return false
  }
  if (!isHqHistoryTabOpen(entry, useAppStore.getState().unifiedTabsByWorktree)) {
    return false
  }
  openHqChat(hqChatKey(entry.worktreeId, entry.tabId))
  return true
}

export async function openHqHistoryEntry(entry: HqHistoryEntry): Promise<void> {
  if (openIfListed(entry) || !entry.worktreeId || !entry.sessionId) {
    return
  }
  const outcome = await revealStructuredSession({
    worktreeId: entry.worktreeId,
    sessionId: entry.sessionId
  })
  if (outcome === 'gone') {
    structuredSessionOpenFeedback.gone()
    return
  }
  if (outcome === 'host-cannot-open') {
    structuredSessionOpenFeedback.hostCannotOpen()
    return
  }
  if (outcome === 'revealed') {
    // Why: the republished tab reaches the store through the inventory, so it is read once more.
    await refreshStructuredSessionTabs(entry.worktreeId).catch(() => undefined)
    if (openIfListed(entry)) {
      return
    }
  }
  structuredSessionOpenFeedback.unavailable()
}
