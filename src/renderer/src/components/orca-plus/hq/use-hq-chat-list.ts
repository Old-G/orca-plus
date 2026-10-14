// Custom build (hq-chats): the live HQ chat list, rebuilt as the board and the chat tabs change.
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getStructuredAgentSessionTabs } from '../../native-chat/structured-agent-session-tabs'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import { projectAccentColor } from '../../../../../shared/project-accent-color'
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

/** A project's accent color by its id; folders and projects on the neutral default get one from
 *  the palette. */
export function useHqProjectColor(): (projectId: string) => string {
  const repos = useAppStore((state) => state.repos)
  return useMemo(() => {
    const picked = new Map(repos.map((repo) => [repo.id, repo.badgeColor]))
    return (projectId: string) => projectAccentColor(projectId, picked.get(projectId))
  }, [repos])
}
