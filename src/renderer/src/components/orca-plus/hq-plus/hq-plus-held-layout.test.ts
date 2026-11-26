import { describe, expect, it } from 'vitest'
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import type { Tab } from '../../../../../shared/workspace-layout/tab-groups/tab-types'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqPlusChatTree } from './hq-plus-chat-tree'
import { holdSideLayout, type HqPlusSideLayout } from './hq-plus-held-layout'

const chat = (sessionId: string, at: number, group: HqChatItem['group'] = 'done'): HqChatItem => {
  const tab: Tab = {
    id: structuredAgentSessionTabId(sessionId),
    entityId: sessionId,
    groupId: 'group-1',
    worktreeId: 'wt-acme',
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
    repoId: 'repo-acme',
    worktreeId: 'wt-acme',
    projectName: 'acme',
    worktreeName: 'main',
    hostKind: 'local',
    sortAt: at,
    placedAt: at
  } as HqChatItem
}

const links: HqChatLinksResult = {
  links: [
    ['w1', 'lead'],
    ['w2', 'lead']
  ].map(([sessionId, parentSessionId]) => ({
    sessionId,
    parentSessionId,
    at: 1,
    via: 'launch' as const
  })),
  continues: []
} as unknown as HqChatLinksResult

function layoutOf(items: HqChatItem[], quiet: HqChatItem[] = []): HqPlusSideLayout {
  return {
    chats: {
      marked: [],
      projects: [
        {
          repoId: 'repo-acme',
          projectName: 'acme',
          kept: false,
          items: items.filter((i) => !quiet.includes(i))
        }
      ],
      quiet
    },
    tree: hqPlusChatTree(items, links)
  }
}

const lead = chat('lead', 1)
const w1 = chat('w1', 3)
const w2 = chat('w2', 2)
const other = chat('other', 4)

const shape = (layout: HqPlusSideLayout): string[] =>
  layout.tree.map((row) => `${row.item.key}:${row.depth}:${row.children}`)

describe('holdSideLayout', () => {
  it('keeps a lead in its tree after its last worker closes', () => {
    const held = layoutOf([lead, w1, other])
    const next = layoutOf([lead, other])
    // Without the hold the lead leaves the tree for its project.
    expect(next.tree).toEqual([])
    const kept = holdSideLayout(held, next)
    expect(kept && shape(kept)).toEqual(['lead:0:0'])
  })

  it("leaves a closed lead's workers in place, a level up", () => {
    const held = layoutOf([lead, w1, w2])
    expect(shape(held)).toEqual(['lead:0:2', 'w1:1:0', 'w2:1:0'])
    const kept = holdSideLayout(held, layoutOf([w1, w2]))
    expect(kept && shape(kept)).toEqual(['w1:0:0', 'w2:0:0'])
    expect(kept?.tree.every((row) => row.startedBy === null)).toBe(true)
  })

  it('counts only the workers still open under a lead', () => {
    const held = layoutOf([lead, w1, w2])
    const kept = holdSideLayout(held, layoutOf([lead, w2]))
    expect(kept && shape(kept)).toEqual(['lead:0:1', 'w2:1:0'])
  })

  it('holds a chat in its project when it has gone quiet meanwhile', () => {
    const held = layoutOf([other, lead])
    const quietNow = { ...other, group: 'quiet' as const }
    const kept = holdSideLayout(held, layoutOf([quietNow, lead], [quietNow]))
    expect(kept?.chats.quiet).toEqual([])
    expect(kept?.chats.projects[0].items.map((item) => item.key)).toEqual(['other', 'lead'])
    // The rows are the live ones.
    expect(kept?.chats.projects[0].items[0].group).toBe('quiet')
  })

  it('ends the hold when a chat the column never showed arrives', () => {
    expect(holdSideLayout(layoutOf([lead]), layoutOf([lead, other]))).toBeNull()
  })

  it('drops a project group when its last chat closes and it is not kept', () => {
    const kept = holdSideLayout(layoutOf([lead]), layoutOf([]))
    expect(kept?.chats.projects).toEqual([])
  })

  it("makes an older chat of a line the head when the line's head closes", () => {
    const older = chat('older', 0)
    const continues = {
      links: links.links,
      continues: [{ sessionId: 'lead', fromSessionId: 'older' }]
    } as unknown as HqChatLinksResult
    const items = [lead, older, w1]
    const held: HqPlusSideLayout = {
      chats: layoutOf(items).chats,
      tree: hqPlusChatTree(items, continues)
    }
    expect(held.tree.map((row) => `${row.item.key}:${row.depth}:${row.earlier}`)).toEqual([
      'lead:0:false',
      'older:0:true',
      'w1:1:false'
    ])
    const kept = holdSideLayout(held, layoutOf([older, w1]))
    expect(
      kept?.tree.map((row) => `${row.item.key}:${row.depth}:${row.earlier}:${row.children}`)
    ).toEqual(['older:0:false:1', 'w1:1:false:0'])
  })
})
