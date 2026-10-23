import { describe, expect, it } from 'vitest'
import { layoutHqPlusAgents } from './hq-plus-agents-layout'

describe('layoutHqPlusAgents', () => {
  it('links agents to their project, subagents to their agent, and a spawned agent to its parent', () => {
    const layout = layoutHqPlusAgents([
      {
        key: 'a',
        project: 'Acme',
        paneKey: 'pane-a',
        parentPaneKey: null,
        live: true,
        subagents: [{ id: 's1', live: true }]
      },
      {
        key: 'b',
        project: 'Acme',
        paneKey: 'pane-b',
        parentPaneKey: 'pane-a',
        live: false,
        subagents: []
      },
      {
        key: 'c',
        project: 'Bob',
        paneKey: null,
        parentPaneKey: 'pane-missing',
        live: false,
        subagents: []
      }
    ])
    expect(layout.nodes.filter((node) => node.kind === 'project').map((node) => node.id)).toEqual([
      'p:Acme',
      'p:Bob'
    ])
    expect(layout.edges).toEqual([
      { from: 'p:Acme', to: 'a', live: true, kind: 'project' },
      { from: 'a', to: 'a/s1', live: true, kind: 'sub' },
      { from: 'p:Acme', to: 'b', live: false, kind: 'project' },
      { from: 'p:Bob', to: 'c', live: false, kind: 'project' },
      { from: 'a', to: 'b', live: false, kind: 'spawn' }
    ])
    const xs = layout.nodes.map((node) => node.x)
    expect(Math.max(...xs)).toBeLessThanOrEqual(layout.width)
    expect(layout.height).toBeGreaterThan(Math.max(...layout.nodes.map((node) => node.y)))
  })
})
