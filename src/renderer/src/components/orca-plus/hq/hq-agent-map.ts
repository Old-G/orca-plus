// Custom build (hq-agent-map): a native chat's subagents as a tree — the session's own agent at the
// root, each subagent under the one that spawned it — read from what the chat already holds.
import type { AgentJournalRenderItem } from '../../../../../shared/agent-session-journal-types'
import { subagentItemBlock } from '../../../../../shared/native-chat-subagent-items'
import { normalizeSubagentState } from '../../../../../shared/native-chat-subagent-summary'
import type { NativeChatSubagentEntry } from '../../../../../shared/native-chat-types'
import type { StructuredAgentSubagentRoster } from '../../../../../shared/structured-agent-session-subagent-roster'

export type HqAgentMapNode = {
  entry: NativeChatSubagentEntry
  children: HqAgentMapNode[]
}

export type HqAgentMap = {
  /** The subagents the session's own agent spawned, each with its own. */
  roots: HqAgentMapNode[]
  total: number
  working: number
}

export const NO_HQ_AGENT_MAP: HqAgentMap = { roots: [], total: 0, working: 0 }

/** Who spawned whom, from a subagent's own row and from the rows its agents wrote. Rows the
 *  window has trimmed say nothing, so such a subagent hangs off the root. */
function spawners(items: readonly AgentJournalRenderItem[]): Map<string, string> {
  const parents = new Map<string, string>()
  for (const item of items) {
    if (item.agentId && item.parentAgentId) {
      parents.set(item.agentId, item.parentAgentId)
    }
    const block = item.body.kind === 'message' ? subagentItemBlock(item.body) : null
    if (block?.parentId) {
      parents.set(block.id, block.parentId)
    }
  }
  return parents
}

export function buildHqAgentMap(
  roster: StructuredAgentSubagentRoster,
  items: readonly AgentJournalRenderItem[]
): HqAgentMap {
  if (roster.size === 0) {
    return NO_HQ_AGENT_MAP
  }
  const parents = spawners(items)
  const nodes = new Map<string, HqAgentMapNode>()
  for (const [agentId, named] of roster) {
    nodes.set(agentId, { entry: named.entry, children: [] })
  }
  // Why: a parent chain that loops back must not hide its members; they hang off the root.
  const reachesRoot = (agentId: string): boolean => {
    const seen = new Set([agentId])
    for (let at = parents.get(agentId); at && nodes.has(at); at = parents.get(at)) {
      if (seen.has(at)) {
        return false
      }
      seen.add(at)
    }
    return true
  }
  const roots: HqAgentMapNode[] = []
  let working = 0
  for (const [agentId, node] of nodes) {
    if (normalizeSubagentState(node.entry.state) === 'working') {
      working += 1
    }
    const parent = parents.get(agentId)
    const parentNode = parent ? nodes.get(parent) : undefined
    if (parentNode && reachesRoot(agentId)) {
      parentNode.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const byStart = (a: HqAgentMapNode, b: HqAgentMapNode): number =>
    (a.entry.startedAt ?? 0) - (b.entry.startedAt ?? 0)
  for (const node of nodes.values()) {
    node.children.sort(byStart)
  }
  return { roots: roots.sort(byStart), total: nodes.size, working }
}
