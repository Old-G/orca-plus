import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../../shared/tab-types'
import {
  hqChatCleanupCandidates,
  hqChatCleanupReport,
  type HqChatCleanupGuards
} from './hq-chat-cleanup'
import type { HqChatGroup, HqChatItem } from './hq-chat-list'

const HOUR = 60 * 60_000
const NOW = 1_000 * HOUR

function chat(
  id: string,
  quietFor: number,
  options: { group?: HqChatGroup; card?: Partial<DashboardCard> | null; pinned?: boolean } = {}
): HqChatItem {
  const at = NOW - quietFor
  const tab: Tab = {
    id: `structured-agent-session-${id}`,
    entityId: id,
    groupId: 'g',
    worktreeId: 'wt',
    contentType: 'agent-session',
    agentSessionAgent: 'claude',
    label: `Chat ${id}`,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: at,
    ...(options.pinned ? { isPinned: true } : {})
  }
  const card: DashboardCard | null =
    options.card === null
      ? null
      : {
          paneKey: `pane-${id}`,
          ptyId: null,
          agentType: 'claude',
          bucket: 'done',
          dotState: 'done',
          task: id,
          repoId: 'r',
          worktreeId: 'wt',
          tabId: tab.id,
          leafId: null,
          repoName: 'Acme',
          worktreeName: 'main',
          startedAt: at,
          finishedAt: at,
          stateChangedAt: at,
          unseen: false,
          ...options.card
        }
  return {
    key: `wt\u0000${tab.id}`,
    kind: 'chat',
    tab,
    group: options.group ?? 'quiet',
    displayState: 'done',
    agentType: 'claude',
    card,
    repoId: 'r',
    worktreeId: 'wt',
    projectName: 'Acme',
    worktreeName: 'main',
    hostKind: 'local',
    sortAt: at
  }
}

function guards(extra: Partial<HqChatCleanupGuards> = {}): HqChatCleanupGuards {
  return {
    now: NOW,
    markedKeys: new Set(),
    askSessionId: null,
    waitingSessionIds: new Set(),
    unfinishedPaneKeys: new Set(),
    shownKeys: new Set(),
    ...extra
  }
}

const ids = (items: ReturnType<typeof hqChatCleanupCandidates>): string[] =>
  items.map((candidate) => candidate.item.tab.entityId)

describe('hqChatCleanupCandidates', () => {
  it('closes a read finished chat after 12 hours and any chat after a quiet day', () => {
    const items = [
      chat('fresh-done', 3 * HOUR),
      chat('read-done', 13 * HOUR),
      chat('idle-half-day', 13 * HOUR, { card: { dotState: 'idle', bucket: 'idle' } }),
      chat('idle-two-days', 49 * HOUR, { card: null })
    ]
    const found = hqChatCleanupCandidates(items, guards())
    expect(found.map((c) => [c.item.tab.entityId, c.reason])).toEqual([
      ['idle-two-days', 'stale'],
      ['read-done', 'done']
    ])
  })

  it('never touches what works, needs the owner, is unread, pinned, marked, shown or awaited', () => {
    const items = [
      chat('working', 50 * HOUR, { group: 'working' }),
      chat('needs', 50 * HOUR, { group: 'needs' }),
      chat('unread', 50 * HOUR, { card: { unseen: true } }),
      chat('pinned', 50 * HOUR, { pinned: true }),
      chat('marked', 50 * HOUR),
      chat('shown', 50 * HOUR),
      chat('ask', 50 * HOUR),
      chat('awaited', 50 * HOUR),
      chat('unfinished', 50 * HOUR)
    ]
    const found = hqChatCleanupCandidates(
      items,
      guards({
        markedKeys: new Set(['wt\u0000structured-agent-session-marked']),
        shownKeys: new Set(['wt\u0000structured-agent-session-shown']),
        askSessionId: 'ask',
        waitingSessionIds: new Set(['awaited']),
        unfinishedPaneKeys: new Set(['pane-unfinished'])
      })
    )
    expect(ids(found)).toEqual([])
  })

  it('counts a recent look at the tab as activity', () => {
    const item = chat('looked', 30 * HOUR)
    if (item.kind === 'chat') {
      item.tab.lastFocusedAt = NOW - HOUR
    }
    expect(ids(hqChatCleanupCandidates([item], guards()))).toEqual([])
  })
})

describe('hqChatCleanupReport', () => {
  it('says what would close in report mode, by project, without closing anything', () => {
    const found = hqChatCleanupCandidates([chat('a', 13 * HOUR)], guards())
    const text = hqChatCleanupReport(found, {
      mode: 'report',
      now: NOW,
      title: (item) => item.tab.label
    })
    expect(text).toContain('пробный прогон')
    expect(text).toContain('## Acme · 1')
    expect(text).toContain('- «Chat a» — готов и прочитан, тихо 13 ч')
  })
})
