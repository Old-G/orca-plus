// Custom build (hq-chats): the HQ chat list — every agent session in one list, ordered by what it
// needs from the user. Native chats come from their tabs (a chat before its first turn has no
// card); terminal agents come from their dashboard cards.
import type { AgentType } from '../../../../../shared/agent-status-types'
import {
  dashboardCardDisplayState,
  type DashboardCard,
  type DashboardCardDisplayState,
  type DashboardCardHostKind,
  type DashboardSnapshot,
  type DashboardWorkspace
} from '../../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../../shared/tab-types'

export type HqChatGroup = 'needs' | 'working' | 'done' | 'quiet'

export const HQ_CHAT_GROUP_ORDER: readonly HqChatGroup[] = ['needs', 'working', 'done', 'quiet']

type HqChatBase = {
  /** Stable selection identity, unique across workspaces. */
  key: string
  group: HqChatGroup
  displayState: DashboardCardDisplayState
  agentType: AgentType
  card: DashboardCard | null
  repoId: string
  worktreeId: string
  projectName: string
  worktreeName: string
  hostKind: DashboardCardHostKind
  /** Newest first within a group. */
  sortAt: number
}

export type HqChatItem =
  | (HqChatBase & { kind: 'chat'; tab: Tab })
  | (HqChatBase & { kind: 'terminal'; card: DashboardCard })

export function hqChatKey(worktreeId: string, tabId: string): string {
  return `${worktreeId}\u0000${tabId}`
}

/** The tab a chat lives in; a terminal's agents may share it with their split panes. */
export function hqChatTabId(item: HqChatItem): string {
  return item.kind === 'chat' ? item.tab.id : item.card.tabId
}

function groupForCard(card: DashboardCard | null): HqChatGroup {
  if (!card) {
    return 'quiet'
  }
  if (card.bucket === 'attention') {
    return 'needs'
  }
  if (card.bucket === 'working') {
    return 'working'
  }
  return dashboardCardDisplayState(card) === 'done' ? 'done' : 'quiet'
}

function base(
  card: DashboardCard | null,
  workspace: DashboardWorkspace,
  fallbackSortAt: number
): Omit<HqChatBase, 'key' | 'agentType'> {
  return {
    group: groupForCard(card),
    displayState: card ? dashboardCardDisplayState(card) : 'idle',
    card,
    repoId: workspace.repoId,
    worktreeId: workspace.worktreeId,
    projectName: workspace.repoName,
    worktreeName: workspace.worktreeName,
    hostKind: card?.hostKind ?? workspace.hostKind,
    sortAt: card ? card.stateChangedAt || card.startedAt : fallbackSortAt
  }
}

/** Builds the list from the live board and the open native-chat tabs; workspaces the board does
 *  not list (removed, archived) drop their chats. */
export function buildHqChatList(
  snapshot: Pick<DashboardSnapshot, 'cards' | 'workspaces'>,
  structuredTabs: readonly Tab[]
): HqChatItem[] {
  const workspaces = new Map((snapshot.workspaces ?? []).map((w) => [w.worktreeId, w]))
  const cardsByTab = new Map<string, DashboardCard>()
  for (const card of snapshot.cards) {
    cardsByTab.set(hqChatKey(card.worktreeId, card.tabId), card)
  }
  const items: HqChatItem[] = []
  const chatKeys = new Set<string>()
  for (const tab of structuredTabs) {
    const workspace = workspaces.get(tab.worktreeId)
    if (!workspace || tab.contentType !== 'agent-session' || !tab.agentSessionAgent) {
      continue
    }
    const key = hqChatKey(tab.worktreeId, tab.id)
    chatKeys.add(key)
    const card = cardsByTab.get(key) ?? null
    items.push({
      ...base(card, workspace, tab.lastFocusedAt ?? tab.createdAt),
      key,
      kind: 'chat',
      agentType: tab.agentSessionAgent,
      tab
    })
  }
  for (const card of snapshot.cards) {
    const key = hqChatKey(card.worktreeId, card.tabId)
    const workspace = workspaces.get(card.worktreeId)
    if (chatKeys.has(key) || !workspace) {
      continue
    }
    items.push({
      ...base(card, workspace, 0),
      key: card.paneKey,
      kind: 'terminal',
      card,
      agentType: card.agentType
    })
  }
  return items.sort((a, b) => b.sortAt - a.sortAt)
}

export function groupHqChats(items: readonly HqChatItem[]): Record<HqChatGroup, HqChatItem[]> {
  const groups: Record<HqChatGroup, HqChatItem[]> = { needs: [], working: [], done: [], quiet: [] }
  for (const item of items) {
    groups[item.group].push(item)
  }
  return groups
}

/** The chat HQ shows: the first candidate still listed (the one clicked, then the one last
 *  shown), else the first that needs the user or is working; null leaves the pane empty. */
export function pickHqChat(
  items: readonly HqChatItem[],
  candidates: readonly (string | null)[]
): string | null {
  for (const candidate of candidates) {
    // Why: a request names a tab; a terminal's chat is keyed by its pane, so the tab finds its pane.
    const item =
      items.find((entry) => entry.key === candidate) ??
      items.find((entry) => hqChatKey(entry.worktreeId, hqChatTabId(entry)) === candidate)
    if (candidate && item) {
      return item.key
    }
  }
  return (
    items.find((item) => item.group === 'needs')?.key ??
    items.find((item) => item.group === 'working')?.key ??
    null
  )
}

/** The waiting chat after `current` in list order, wrapping round; null when none waits. */
export function nextHqWaitingChat(
  needs: readonly HqChatItem[],
  current: string | null
): string | null {
  if (needs.length === 0) {
    return null
  }
  const index = needs.findIndex((item) => item.key === current)
  return needs[(index + 1) % needs.length].key
}

/** Two-letter mark for a project avatar: initials of its first two words, else its first two letters. */
export function hqProjectInitials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  const letters = words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}
