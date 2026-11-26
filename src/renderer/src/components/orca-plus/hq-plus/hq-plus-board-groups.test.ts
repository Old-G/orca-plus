import { describe, expect, it } from 'vitest'
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import type { Tab } from '../../../../../shared/workspace-layout/tab-groups/tab-types'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqPlusChatTree } from './hq-plus-chat-tree'
import { hqPlusLooseRows, hqPlusWorkView } from './hq-plus-work-view'

const chat = (
  sessionId: string,
  group: HqChatItem['group'],
  at: number,
  project = 'acme'
): HqChatItem => {
  const tab: Tab = {
    id: structuredAgentSessionTabId(sessionId),
    entityId: sessionId,
    groupId: 'group-1',
    worktreeId: `wt-${project}`,
    contentType: 'agent-session',
    agentSessionAgent: 'claude',
    label: sessionId,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: at
  }
  return {
    kind: 'chat',
    tab,
    key: sessionId,
    group,
    displayState: 'idle',
    agentType: 'claude',
    card: null,
    repoId: `repo-${project}`,
    worktreeId: `wt-${project}`,
    projectName: project,
    worktreeName: 'main',
    hostKind: 'local',
    sortAt: at,
    placedAt: at
  } as HqChatItem
}

const links = (spawned: [child: string, parent: string][]): HqChatLinksResult => ({
  links: spawned.map(([sessionId, parentSessionId], index) => ({
    sessionId,
    parentSessionId,
    via: 'launch',
    at: index + 1
  })),
  continues: []
})

describe('board groups (T5f)', () => {
  const items = [
    chat('lead', 'working', 10),
    chat('w1', 'quiet', 9),
    chat('w2', 'done', 8, 'beta'),
    chat('solo-a', 'quiet', 7),
    chat('solo-b', 'needs', 6, 'beta')
  ]
  const model = hqPlusWorkView({
    tree: hqPlusChatTree(
      items,
      links([
        ['w1', 'lead'],
        ['w2', 'lead']
      ])
    ),
    links: links([
      ['w1', 'lead'],
      ['w2', 'lead']
    ]),
    sessions: [],
    since: 0
  })

  const loose = hqPlusLooseRows(model, items)

  it('a lead keeps its workers; chats without a lead go to one group', () => {
    expect(model.runs.map((run) => run.rows.map((row) => row.item.key))).toEqual([
      ['lead', 'w1', 'w2']
    ])
    expect(loose.map((row) => row.item.key)).toEqual(['solo-a', 'solo-b'])
  })

  it('every open chat is on the board exactly once', () => {
    const keys = [...model.runs.flatMap((run) => run.rows), ...loose].map((row) => row.item.key)
    expect(keys.slice().sort()).toEqual(items.map((item) => item.key).sort())
    expect(new Set(keys).size).toBe(keys.length)
  })
})
