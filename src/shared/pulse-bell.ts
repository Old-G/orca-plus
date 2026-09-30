// Custom build (pulse-bell): what Orca+'s bell shows, and the inbox items its producers raise.
import type { ClaudeHandoffOffer } from './claude-handoff-file'
import type { PulseInboxInput } from './pulse-types'
import { parsePaneKey } from './stable-pane-id'

export const PULSE_BELL_KIND = {
  handoff: 'handoff',
  agentWaiting: 'agent-waiting',
  claudeLimit: 'claude-limit',
  agentFinished: 'agent-finished'
} as const

export const PULSE_BELL_ACTION = {
  launch: 'launch',
  open: 'open',
  switchAccount: 'switch',
  dismiss: 'dismiss'
} as const

/** Kinds the renderer may sync itself; the others are owned by main. */
export const RENDERER_SYNCED_PULSE_BELL_KINDS: readonly string[] = [PULSE_BELL_KIND.claudeLimit]

export type PulseBellInput = PulseInboxInput & { dedupeKey: string }

export function handoffBellItem(offer: ClaudeHandoffOffer): PulseBellInput {
  const place = [offer.worktreeTitle, offer.branch].filter(Boolean).join(' · ')
  return {
    kind: PULSE_BELL_KIND.handoff,
    title: 'Handoff saved, new session ready',
    body: place || null,
    refKind: 'handoff',
    refId: offer.id,
    actions: [
      { id: PULSE_BELL_ACTION.launch, label: 'New session' },
      { id: PULSE_BELL_ACTION.dismiss, label: 'Not now' }
    ],
    dedupeKey: `handoff:${offer.id}`
  }
}

export type WaitingAgent = {
  paneKey: string
  tabId: string | null
  worktreeId: string | null
  worktreeTitle: string | null
  agentType: string | null
  /** A question or permission prompt, not ordinary idle waiting. */
  blocked: boolean
  prompt: string | null
  since: number
}

/** One item per waiting episode, so a dismissed one does not hide the next time this agent waits. */
export function waitingAgentBellItem(agent: WaitingAgent): PulseBellInput {
  const prompt = agent.prompt?.replace(/\s+/g, ' ').trim()
  const body = [agent.worktreeTitle, prompt ? prompt.slice(0, 140) : null]
    .filter(Boolean)
    .join(' · ')
  return {
    kind: PULSE_BELL_KIND.agentWaiting,
    title: agent.blocked ? 'An agent needs your permission' : 'An agent is waiting for you',
    body: body || null,
    urgency: agent.blocked ? 'urgent' : 'normal',
    refKind: 'pane',
    refId: JSON.stringify({
      paneKey: agent.paneKey,
      tabId: agent.tabId,
      worktreeId: agent.worktreeId
    }),
    actions: [
      { id: PULSE_BELL_ACTION.open, label: 'Open' },
      { id: PULSE_BELL_ACTION.dismiss, label: 'Not now' }
    ],
    dedupeKey: `agent-waiting:${agent.paneKey}:${agent.since}`
  }
}

export type FinishedAgent = {
  paneKey: string
  worktreeId: string | null
  /** `Claude`, `Codex`… */
  agentLabel: string
  /** `repo / worktree`, or whichever of the two is known. */
  place: string | null
  /** The tab or chat name, so two agents in one worktree read apart. */
  sessionTitle: string | null
  lastMessage: string | null
}

/** One open item per pane: a newer finish replaces the older one. */
export function agentFinishedBellItem(agent: FinishedAgent): PulseBellInput {
  const who = [agent.agentLabel, agent.place, agent.sessionTitle].filter(Boolean).join(' · ')
  const said = agent.lastMessage?.replace(/\s+/g, ' ').trim()
  return {
    kind: PULSE_BELL_KIND.agentFinished,
    title: 'An agent finished',
    body: said ? `${who} — ${said.slice(0, 160)}` : who,
    refKind: 'pane',
    refId: JSON.stringify({
      paneKey: agent.paneKey,
      tabId: parsePaneKey(agent.paneKey)?.tabId ?? null,
      worktreeId: agent.worktreeId
    }),
    actions: [
      { id: PULSE_BELL_ACTION.open, label: 'Open' },
      { id: PULSE_BELL_ACTION.dismiss, label: 'Not now' }
    ],
    dedupeKey: `agent-finished:${agent.paneKey}`
  }
}

export type PulseBellPaneRef = { paneKey: string; tabId: string | null; worktreeId: string | null }

export function readPulseBellPaneRef(refId: string | null): PulseBellPaneRef | null {
  if (!refId) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(refId)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const paneKey: unknown = Reflect.get(parsed, 'paneKey')
    const tabId: unknown = Reflect.get(parsed, 'tabId')
    const worktreeId: unknown = Reflect.get(parsed, 'worktreeId')
    return typeof paneKey === 'string'
      ? {
          paneKey,
          tabId: typeof tabId === 'string' ? tabId : null,
          worktreeId: typeof worktreeId === 'string' ? worktreeId : null
        }
      : null
  } catch {
    return null
  }
}
