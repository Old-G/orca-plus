// Custom build (hq-plus-ui-v5): where the Agents graph draws each project, agent and subagent —
// projects along the top, their agents under them, each agent's subagents under it — and the lines
// between them, including an agent that spawned another one.

export type HqPlusAgentInput = {
  key: string
  project: string
  /** The pane that spawned this agent, matched against other agents' `paneKey`. */
  parentPaneKey: string | null
  paneKey: string | null
  live: boolean
  subagents: readonly { id: string; live: boolean }[]
}

export type HqPlusAgentNode =
  | { kind: 'project'; id: string; x: number; y: number; label: string }
  | { kind: 'agent'; id: string; x: number; y: number; live: boolean }
  | { kind: 'sub'; id: string; x: number; y: number; live: boolean }

export type HqPlusAgentEdge = {
  from: string
  to: string
  live: boolean
  kind: 'project' | 'sub' | 'spawn'
}

export type HqPlusAgentLayout = {
  width: number
  height: number
  nodes: HqPlusAgentNode[]
  edges: HqPlusAgentEdge[]
}

const COLUMN = 120
const AGENT_STEP = 34
const ROW = { project: 28, agent: 104, sub: 172 }
const SUB_STEP = 14

export function layoutHqPlusAgents(agents: readonly HqPlusAgentInput[]): HqPlusAgentLayout {
  const projects = [...new Set(agents.map((agent) => agent.project))]
  const nodes: HqPlusAgentNode[] = []
  const edges: HqPlusAgentEdge[] = []
  const byPane = new Map<string, string>()
  let x = 0
  for (const project of projects) {
    const own = agents.filter((agent) => agent.project === project)
    const span = Math.max(COLUMN, own.length * AGENT_STEP + 40)
    const center = x + span / 2
    nodes.push({ kind: 'project', id: `p:${project}`, x: center, y: ROW.project, label: project })
    own.forEach((agent, index) => {
      const ax = center + (index - (own.length - 1) / 2) * AGENT_STEP
      nodes.push({ kind: 'agent', id: agent.key, x: ax, y: ROW.agent, live: agent.live })
      edges.push({ from: `p:${project}`, to: agent.key, live: agent.live, kind: 'project' })
      if (agent.paneKey) {
        byPane.set(agent.paneKey, agent.key)
      }
      agent.subagents.forEach((sub, subIndex) => {
        const sx = ax + (subIndex - (agent.subagents.length - 1) / 2) * SUB_STEP
        const id = `${agent.key}/${sub.id}`
        nodes.push({ kind: 'sub', id, x: sx, y: ROW.sub, live: sub.live })
        edges.push({ from: agent.key, to: id, live: sub.live, kind: 'sub' })
      })
    })
    x += span
  }
  for (const agent of agents) {
    const parent = agent.parentPaneKey ? byPane.get(agent.parentPaneKey) : undefined
    if (parent && parent !== agent.key) {
      edges.push({ from: parent, to: agent.key, live: agent.live, kind: 'spawn' })
    }
  }
  const hasSubs = agents.some((agent) => agent.subagents.length > 0)
  return {
    width: Math.max(x, COLUMN),
    height: hasSubs ? ROW.sub + 24 : ROW.agent + 30,
    nodes,
    edges
  }
}
