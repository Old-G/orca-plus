// Custom build (hq-plus-chat-tree, owner 04.11): the left column's «By work» view — each open chat under
// the chat that started it or handed it work, in any project, from recorded links only. A handoff is the
// same chat going on: the new chat takes the old one's place, and children of either hang under it.
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqChatSessionId } from '../hq/hq-chat-cleanup'

/** The chats that started others, each with the chats under it; lone chats are left out. */
export type HqPlusTreeRow = {
  item: HqChatItem
  /** 0 for a chat nobody open started. */
  depth: number
  /** Custom build (hq-plus-work-view): the open chats right under this one (0 for an older chat of a line). */
  children: number
  /** Custom build (hq-plus-work-view): an older open chat of the same line, after a handoff. */
  earlier: boolean
  /**
   * Custom build (hq-plus-work-view): for a top row, the first chat of the work it hangs from when that
   * chat is closed — the lead whose workers outlived it; null when nobody started it.
   */
  startedBy: string | null
}

const GROUP_ORDER = { needs: 0, working: 1, done: 2, quiet: 3 } as const
const MAX_HOPS = 64

type Node = {
  head: HqChatItem
  /** Older open chats of the same line, still open after a handoff. */
  earlier: HqChatItem[]
  children: Node[]
}

function sessionOf(item: HqChatItem): string | null {
  return item.kind === 'chat' ? hqChatSessionId(item.tab.id) : null
}

function createdAt(item: HqChatItem): number {
  return item.kind === 'chat' ? item.tab.createdAt : item.sortAt
}

/** What needs the owner first, then the latest activity — for a whole branch. */
function rankOf(node: Node): { group: number; at: number } {
  const all = [node.head, ...node.earlier]
  let group = Math.min(...all.map((item) => GROUP_ORDER[item.group]))
  let at = Math.max(0, ...all.map((item) => item.sortAt))
  for (const child of node.children) {
    const rank = rankOf(child)
    group = Math.min(group, rank.group)
    at = Math.max(at, rank.at)
  }
  return { group, at }
}

function sortNodes(nodes: Node[]): Node[] {
  const ranked = nodes.map((node) => ({ node, rank: rankOf(node) }))
  ranked.sort((a, b) => a.rank.group - b.rank.group || b.rank.at - a.rank.at)
  return ranked.map(({ node }) => {
    node.children = sortNodes(node.children)
    return node
  })
}

export function hqPlusChatTree(
  items: readonly HqChatItem[],
  links: HqChatLinksResult | null
): HqPlusTreeRow[] {
  const previous = new Map(
    (links?.continues ?? []).map((step) => [step.sessionId, step.fromSessionId])
  )
  // Why: the line's first chat names the work; a handoff chain walks back to it.
  const lineOf = (sessionId: string): string => {
    let current = sessionId
    const seen = new Set([current])
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const from = previous.get(current)
      if (!from || seen.has(from)) {
        break
      }
      seen.add(from)
      current = from
    }
    return current
  }
  // Why: the earliest fact wins, as it does when a link is written.
  const parentOfLine = new Map<string, string>()
  const launchedLines = new Set<string>()
  for (const link of [...(links?.links ?? [])].sort((a, b) => a.at - b.at)) {
    const line = lineOf(link.sessionId)
    // Why: a chat writing to its own continuation is one line, not a parent.
    if (!parentOfLine.has(line) && lineOf(link.parentSessionId) !== line) {
      parentOfLine.set(line, link.parentSessionId)
      if (link.via === 'launch') {
        launchedLines.add(line)
      }
    }
  }

  const nodeOfLine = new Map<string, Node>()
  const loose: Node[] = []
  for (const item of [...items].sort((a, b) => createdAt(b) - createdAt(a))) {
    const sessionId = sessionOf(item)
    if (!sessionId) {
      loose.push({ head: item, earlier: [], children: [] })
      continue
    }
    const line = lineOf(sessionId)
    const known = nodeOfLine.get(line)
    if (known) {
      known.earlier.push(item)
      continue
    }
    const node: Node = { head: item, earlier: [], children: [] }
    nodeOfLine.set(line, node)
  }

  // Why: a closed parent passes its children up to the nearest open chat above it.
  const parentNodeOf = (line: string): Node | null => {
    let current = line
    const seen = new Set([line])
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const parent = parentOfLine.get(current)
      if (!parent) {
        return null
      }
      const up = lineOf(parent)
      if (seen.has(up)) {
        return null
      }
      seen.add(up)
      const open = nodeOfLine.get(up)
      if (open) {
        return open
      }
      current = up
    }
    return null
  }
  const parentOf = new Map<Node, Node>()
  const orphans = new Set<Node>()
  for (const [line, node] of nodeOfLine) {
    if (launchedLines.has(line)) {
      orphans.add(node)
    }
    const parent = parentNodeOf(line)
    if (parent && parent !== node) {
      parentOf.set(node, parent)
    }
  }
  // Why: links are facts but may still loop through closed chats; a loop's node stands alone.
  for (const node of nodeOfLine.values()) {
    const seen = new Set<Node>([node])
    let current = parentOf.get(node)
    while (current) {
      if (seen.has(current)) {
        parentOf.delete(node)
        break
      }
      seen.add(current)
      current = parentOf.get(current)
    }
  }

  const roots: Node[] = [...loose]
  for (const node of nodeOfLine.values()) {
    const parent = parentOf.get(node)
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  // Why: the work's first chat, up the recorded links through closed chats — the lead a block is named by.
  const lineOfNode = new Map([...nodeOfLine].map(([line, node]) => [node, line]))
  const leadOf = (node: Node): string | null => {
    let current = lineOfNode.get(node)
    let lead: string | null = null
    const seen = new Set<string>()
    for (let hop = 0; current && hop < MAX_HOPS; hop += 1) {
      const parent = parentOfLine.get(current)
      if (!parent) {
        break
      }
      const up = lineOf(parent)
      if (seen.has(up)) {
        break
      }
      seen.add(up)
      lead = up
      current = up
    }
    return lead
  }
  const rows: HqPlusTreeRow[] = []
  const walk = (node: Node, depth: number): void => {
    rows.push({
      item: node.head,
      depth,
      children: node.children.length,
      earlier: false,
      startedBy: depth === 0 ? leadOf(node) : null
    })
    for (const item of node.earlier) {
      rows.push({ item, depth, children: 0, earlier: true, startedBy: null })
    }
    for (const child of node.children) {
      walk(child, depth + 1)
    }
  }
  // Custom build (hq-plus-chat-tree, owner 05.11): only work that branched — a chat with chats under it;
  // a chat on its own stays under its project below, or the list reads as one heap. A chat another chat
  // started stays here when that chat is closed, on its own: it moving down to its project read as
  // closed with its parent (owner 05.11). One a closed chat only wrote to goes back to its project.
  for (const root of sortNodes(roots)) {
    if (root.children.length > 0 || orphans.has(root)) {
      walk(root, 0)
    }
  }
  return rows
}
