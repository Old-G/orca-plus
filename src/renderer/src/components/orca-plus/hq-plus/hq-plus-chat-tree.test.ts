import { describe, expect, it } from 'vitest'
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import type { Tab } from '../../../../../shared/tab-types'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqPlusChatTree } from './hq-plus-chat-tree'

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
    sortAt: at
  } as HqChatItem
}

const links = (
  spawned: [child: string, parent: string, at?: number, via?: 'launch' | 'send'][],
  continues: [next: string, from: string][] = []
): HqChatLinksResult => ({
  links: spawned.map(([sessionId, parentSessionId, at = 1, via = 'launch']) => ({
    sessionId,
    parentSessionId,
    via,
    at
  })),
  continues: continues.map(([sessionId, fromSessionId]) => ({ sessionId, fromSessionId }))
})

const shape = (rows: ReturnType<typeof hqPlusChatTree>): string[] =>
  rows.map((row) => `${'  '.repeat(row.depth)}${row.item.key}`)

describe('HQ+ «By work» tree', () => {
  it('puts chats a chat started under it, across projects, and the rest beside', () => {
    const rows = hqPlusChatTree(
      [
        chat('brain', 'working', 10, 'orca'),
        chat('dev', 'needs', 20, 'support'),
        chat('strata', 'working', 30, 'strata'),
        chat('remote', 'done', 40, 'orca')
      ],
      links([
        ['dev', 'brain'],
        ['strata', 'brain']
      ])
    )
    expect(shape(rows)).toEqual(['brain', '  dev', '  strata'])
  })

  it('without links lists no tree; lone chats stay under their projects', () => {
    const rows = hqPlusChatTree(
      [chat('a', 'done', 10), chat('b', 'needs', 5), chat('c', 'working', 20)],
      null
    )
    expect(shape(rows)).toEqual([])
  })

  it('a handoff is the same line: the new chat takes the parent place and keeps the children', () => {
    const rows = hqPlusChatTree(
      [chat('parent-2', 'working', 50), chat('child', 'working', 20)],
      links([['child', 'parent-1']], [['parent-2', 'parent-1']])
    )
    expect(shape(rows)).toEqual(['parent-2', '  child'])
  })

  it('a handed-off child stays under its parent, and is never its own parent', () => {
    const rows = hqPlusChatTree(
      [chat('parent', 'working', 10), chat('child-2', 'done', 30)],
      links(
        [
          ['child-1', 'parent'],
          ['child-2', 'child-1']
        ],
        [['child-2', 'child-1']]
      )
    )
    expect(shape(rows)).toEqual(['parent', '  child-2'])
  })

  it('a closed parent passes its children to the open chat above it', () => {
    const rows = hqPlusChatTree(
      [chat('top', 'working', 10), chat('leaf', 'working', 30)],
      links([
        ['middle', 'top'],
        ['leaf', 'middle']
      ])
    )
    expect(shape(rows)).toEqual(['top', '  leaf'])
  })

  it('a chat whose starter was closed stays in the tree on its own, without a parent', () => {
    const rows = hqPlusChatTree(
      [chat('step-4', 'working', 30, 'hq'), chat('other', 'working', 40)],
      links([['step-4', 'brain']])
    )
    expect(shape(rows)).toEqual(['step-4'])
  })

  it('a chat a closed chat only wrote to goes back to its project', () => {
    const rows = hqPlusChatTree([chat('old', 'done', 30)], links([['old', 'gone', 1, 'send']]))
    expect(shape(rows)).toEqual([])
  })

  it('a loop in the links leaves every chat listed once', () => {
    const rows = hqPlusChatTree(
      [chat('a', 'working', 10), chat('b', 'working', 20)],
      links([
        ['a', 'b'],
        ['b', 'a']
      ])
    )
    expect(rows.length).toBeLessThanOrEqual(2)
    expect(new Set(rows.map((row) => row.item.key)).size).toBe(rows.length)
  })

  it('the earliest link wins for a chat handed work by two chats', () => {
    const rows = hqPlusChatTree(
      [chat('first', 'working', 10), chat('second', 'working', 20), chat('kid', 'done', 30)],
      links([
        ['kid', 'second', 9],
        ['kid', 'first', 5]
      ])
    )
    expect(shape(rows)).toEqual(['first', '  kid'])
  })
})
