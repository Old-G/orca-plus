// Custom build (hq-slack-intake): where HQ can send a message — the projects, the chats of one, and
// the workspace a new chat in it starts in.
import type { AppState } from '@/store/types'
import { resolveAgentSessionTabTitle } from '../../tab-bar/tab-bar-item-model'

export type HqRouteChat = { sessionId: string; worktreeId: string; title: string; lastAt: number }
export type HqRouteProject = { repoId: string; name: string }

type RouteState = Pick<AppState, 'repos' | 'worktreesByRepo' | 'unifiedTabsByWorktree' | 'settings'>

export const HQ_ROUTE_NEW_CHAT = 'new'
export const hqRouteChatValue = (sessionId: string): string => `chat:${sessionId}`

export function hqRouteProjects(state: Pick<RouteState, 'repos'>): HqRouteProject[] {
  return state.repos
    .map((repo) => ({ repoId: repo.id, name: repo.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function liveWorktrees(state: RouteState, repoId: string) {
  return (state.worktreesByRepo[repoId] ?? []).filter((worktree) => !worktree.isArchived)
}

/** The project's native chats, the one used last first. */
export function hqProjectChats(state: RouteState, repoId: string | null): HqRouteChat[] {
  if (!repoId) {
    return []
  }
  const generated = state.settings?.tabAutoGenerateTitle === true
  return liveWorktrees(state, repoId)
    .flatMap((worktree) =>
      (state.unifiedTabsByWorktree[worktree.id] ?? []).flatMap((tab) =>
        tab.contentType === 'agent-session' && tab.agentSessionAgent && tab.entityId
          ? [
              {
                sessionId: tab.entityId,
                worktreeId: worktree.id,
                title: resolveAgentSessionTabTitle(tab, null, generated),
                lastAt: tab.lastFocusedAt ?? tab.createdAt
              }
            ]
          : []
      )
    )
    .sort((a, b) => b.lastAt - a.lastAt)
}

/** Where a new chat of the project starts: its main workspace, else its first open one. */
export function hqProjectNewChatWorktree(state: RouteState, repoId: string | null): string | null {
  if (!repoId) {
    return null
  }
  const worktrees = liveWorktrees(state, repoId)
  return (worktrees.find((worktree) => worktree.isMainWorktree) ?? worktrees[0])?.id ?? null
}

export function hqRepoOfWorktree(state: RouteState, worktreeId: string | null): string | null {
  if (!worktreeId) {
    return null
  }
  for (const [repoId, worktrees] of Object.entries(state.worktreesByRepo)) {
    if (worktrees?.some((worktree) => worktree.id === worktreeId)) {
      return repoId
    }
  }
  return null
}
