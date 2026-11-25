// Custom build (hq-chats): the live HQ chat list, rebuilt as the board and the chat tabs change.
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getStructuredAgentSessionTabs } from '../../native-chat/session/status/structured-agent-session-tabs'
import { useLiveDashboardSnapshot } from '../../dashboard/snapshot/useLiveDashboardSnapshot'
import type { DashboardCard } from '../../../../../shared/agent-status/presentation/dashboard-snapshot'
import { projectMarkColors } from '../../../../../shared/project-accent-color'
import { buildHqChatList, type HqChatItem } from './hq-chat-list'

export function useHqChatList(): { items: HqChatItem[]; cards: readonly DashboardCard[] } {
  const snapshot = useLiveDashboardSnapshot()
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const items = useMemo(
    () => buildHqChatList(snapshot, getStructuredAgentSessionTabs(unifiedTabsByWorktree)),
    [snapshot, unifiedTabsByWorktree]
  )
  return { items, cards: snapshot.cards }
}

/** A project's color by its id, the same as its mark in the sidebar; a folder gets a palette color. */
export function useHqProjectColor(): (projectId: string) => string {
  const repos = useAppStore((state) => state.repos)
  return useMemo(() => projectMarkColors(repos), [repos])
}
