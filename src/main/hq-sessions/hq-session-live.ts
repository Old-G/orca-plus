// Custom build (hq-plus-sessions): what each chat is doing now, put together from the journal's
// sessions, the agents' live status, the open tabs and what the owner last looked at.
import type { HqSession } from '../../shared/hq-journal'
import type { HqLiveSession } from '../../shared/hq-sessions'

const NATIVE_CHAT_TAB = 'structured-agent-session-'

/** The chat a tab or pane key belongs to (`structured-agent-session-<id>[:<tab>]`); null for others. */
export function hqChatSessionOf(key: string): string | null {
  if (!key.startsWith(NATIVE_CHAT_TAB)) {
    return null
  }
  const rest = key.slice(NATIVE_CHAT_TAB.length)
  const colon = rest.indexOf(':')
  return (colon === -1 ? rest : rest.slice(0, colon)) || null
}

export type HqAgentSighting = {
  sessionId: string
  state: 'working' | 'waiting' | 'blocked' | 'done' | string
  updatedAt: number
}

export type HqChatTab = {
  sessionId: string
  worktreeId: string
  lastFocusedAt: number | null
  /** On screen now: the active tab of the active workspace. */
  focused: boolean
}

export type HqLiveInputs = {
  sessions: readonly HqSession[]
  agents: readonly HqAgentSighting[]
  tabs: readonly HqChatTab[]
  /** Chats with a question to the owner still open. */
  asking: ReadonlySet<string>
  contextPct: ReadonlyMap<string, number>
  name: (sessionId: string) => string | null
  /** For a chat the journal has not seen yet: its project and room, by workspace. */
  placeOfWorktree: (worktreeId: string) => { project: string | null; workspace: string }
  now: number
}

export function hqLiveSessions(inputs: HqLiveInputs): HqLiveSession[] {
  const agents = new Map(inputs.agents.map((agent) => [agent.sessionId, agent]))
  const tabs = new Map(inputs.tabs.map((tab) => [tab.sessionId, tab]))
  const known = new Map(inputs.sessions.map((session) => [session.sessionId, session]))
  const ids = new Set([...known.keys(), ...tabs.keys()])
  const live: HqLiveSession[] = []
  for (const sessionId of ids) {
    const session = known.get(sessionId) ?? null
    const tab = tabs.get(sessionId) ?? null
    const agent = agents.get(sessionId) ?? null
    const worktreeId = session?.worktreeId ?? tab?.worktreeId ?? null
    const place = session || !worktreeId ? null : inputs.placeOfWorktree(worktreeId)
    const state: HqLiveSession['state'] =
      agent?.state === 'working'
        ? 'working'
        : agent?.state === 'waiting' || agent?.state === 'blocked' || inputs.asking.has(sessionId)
          ? 'waiting'
          : !tab || session?.state === 'closed'
            ? 'closed'
            : 'done'
    live.push({
      sessionId,
      address: session?.address ?? null,
      project: session?.project ?? place?.project ?? null,
      workspace: session?.workspace ?? place?.workspace ?? '_unassigned',
      worktreeId,
      name: inputs.name(sessionId),
      state,
      midTurn:
        agent?.state === 'working' || agent?.state === 'waiting' || agent?.state === 'blocked',
      lastActivityAt: Math.max(session?.lastActivityAt ?? 0, agent?.updatedAt ?? 0),
      contextPct: inputs.contextPct.get(sessionId) ?? session?.contextPct ?? null,
      ownerAt: tab ? (tab.focused ? inputs.now : tab.lastFocusedAt) : null,
      tabOpen: tab !== null
    })
  }
  return live.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}
