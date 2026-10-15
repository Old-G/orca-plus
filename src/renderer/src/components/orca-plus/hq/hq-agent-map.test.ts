import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../../../shared/agent-session-journal-types'
import type {
  NativeChatSubagentEntry,
  NativeChatSubagentState
} from '../../../../../shared/native-chat-types'
import type { StructuredAgentSubagentRoster } from '../../../../../shared/structured-agent-session-subagent-roster'
import { buildHqAgentMap, type HqAgentMapNode } from './hq-agent-map'

function roster(
  agents: [id: string, state: NativeChatSubagentState, startedAt: number][]
): StructuredAgentSubagentRoster {
  return new Map(
    agents.map(([id, state, startedAt], index) => {
      const entry: NativeChatSubagentEntry = { id, label: `task ${id}`, state, startedAt }
      return [
        id,
        {
          entry,
          rosterItemId: 'roster',
          rosterPosition: { sequence: index, index: 0 },
          rosterRevision: 1
        }
      ]
    })
  )
}

/** A subagent's own row, naming the subagent that spawned it. */
function spawnRow(id: string, parentId?: string): AgentJournalRenderItem {
  return {
    itemId: `row-${id}`,
    revision: 1,
    sequence: 1,
    observedAt: 1,
    body: {
      kind: 'message',
      role: 'system',
      blocks: [
        {
          type: 'subagent',
          id,
          label: `task ${id}`,
          state: 'working',
          groupId: 'turn-1',
          ...(parentId ? { parentId } : {})
        }
      ]
    }
  }
}

/** A row a subagent wrote, carrying its own parent. */
function producedRow(agentId: string, parentAgentId: string): AgentJournalRenderItem {
  return {
    itemId: `out-${agentId}`,
    revision: 1,
    sequence: 2,
    observedAt: 2,
    agentId,
    parentAgentId,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'hi' }] }
  }
}

const shape = (nodes: HqAgentMapNode[]): unknown =>
  nodes.map((node) => [node.entry.id, shape(node.children)])

describe('buildHqAgentMap', () => {
  it('hangs each subagent under its spawner, oldest first, and counts the working ones', () => {
    const map = buildHqAgentMap(
      roster([
        ['b', 'completed', 2],
        ['a', 'working', 1],
        ['a1', 'working', 3],
        ['a1x', 'failed', 4]
      ]),
      [spawnRow('a'), spawnRow('b'), spawnRow('a1', 'a'), producedRow('a1x', 'a1')]
    )
    expect(shape(map.roots)).toEqual([
      ['a', [['a1', [['a1x', []]]]]],
      ['b', []]
    ])
    expect(map).toMatchObject({ total: 4, working: 2 })
  })

  it('keeps a subagent whose spawner is unknown or loops, at the root', () => {
    const map = buildHqAgentMap(
      roster([
        ['x', 'idle', 1],
        ['y', 'idle', 2],
        ['z', 'idle', 3]
      ]),
      [spawnRow('x', 'gone'), spawnRow('y', 'z'), spawnRow('z', 'y')]
    )
    expect(shape(map.roots)).toEqual([
      ['x', []],
      ['y', []],
      ['z', []]
    ])
  })

  it('is empty for a chat with no subagents', () => {
    expect(buildHqAgentMap(new Map(), [])).toEqual({ roots: [], total: 0, working: 0 })
  })
})
