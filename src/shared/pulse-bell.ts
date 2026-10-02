// Custom build (pulse-bell): what Orca+'s bell shows, and the inbox items its producers raise.
import type { ClaudeHandoffOffer } from './claude-handoff-file'
import { HQ_DEFERRED_KIND } from './hq-morning-briefing'
import type { PulseInboxInput } from './pulse-types'
import { parsePaneKey } from './stable-pane-id'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from './structured-agent-session-projection'

export const PULSE_BELL_KIND = {
  handoff: 'handoff',
  agentWaiting: 'agent-waiting',
  claudeLimit: 'claude-limit',
  agentFinished: 'agent-finished',
  claudeChatLimit: 'claude-chat-limit',
  claudeAuthStop: 'claude-auth-stop'
} as const

export const PULSE_BELL_ACTION = {
  launch: 'launch',
  open: 'open',
  switchAccount: 'switch',
  continue: 'continue',
  dismiss: 'dismiss'
} as const

/** Kinds the renderer may sync itself; the others are owned by main. */
export const RENDERER_SYNCED_PULSE_BELL_KINDS: readonly string[] = [
  PULSE_BELL_KIND.claudeLimit,
  HQ_DEFERRED_KIND
]

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

const CONTINUE_ON_PREFIX = 'continue-on:'

/** One button per subscription the chat can move to; the id names the subscription. */
export function continueOnSubscriptionActionId(subscriptionId: string): string {
  return `${CONTINUE_ON_PREFIX}${subscriptionId}`
}

export function readContinueOnSubscriptionAction(actionId: string): string | null {
  return actionId.startsWith(CONTINUE_ON_PREFIX)
    ? actionId.slice(CONTINUE_ON_PREFIX.length) || null
    : null
}

export type LimitStoppedChat = {
  sessionId: string
  worktreeId: string | null
  chatTitle: string | null
  subscriptionLabel: string
  /** Where it can continue, in the order the buttons show. */
  alternatives: readonly { id: string; label: string }[]
  stoppedAt: number
}

/** A native chat stopped on its subscription's limit; it continues on another in the same chat. */
export function limitStoppedChatBellItem(chat: LimitStoppedChat): PulseBellInput {
  const tabId = structuredAgentSessionTabId(chat.sessionId)
  return {
    kind: PULSE_BELL_KIND.claudeChatLimit,
    title: 'A chat stopped on its Claude limit',
    body: [chat.chatTitle, `on ${chat.subscriptionLabel}`].filter(Boolean).join(' · '),
    urgency: 'urgent',
    refKind: 'pane',
    refId: JSON.stringify({
      paneKey: structuredAgentSessionPaneKey(tabId, chat.sessionId),
      tabId,
      worktreeId: chat.worktreeId,
      sessionId: chat.sessionId
    }),
    actions: [
      ...chat.alternatives.map((choice) => ({
        id: continueOnSubscriptionActionId(choice.id),
        label: `Continue on ${choice.label}`
      })),
      { id: PULSE_BELL_ACTION.dismiss, label: 'Not now' }
    ],
    dedupeKey: `claude-chat-limit:${chat.sessionId}:${chat.stoppedAt}`
  }
}

/** Agents whose turn the API cut on a rejected sign-in; Continue nudges them once it is fixed. */
export function claudeAuthStopBellItem(stops: readonly { stoppedAt: number }[]): PulseBellInput {
  const firstAt = Math.min(...stops.map((stop) => stop.stoppedAt))
  return {
    kind: PULSE_BELL_KIND.claudeAuthStop,
    title:
      stops.length === 1
        ? 'An agent stopped: Claude rejected the sign-in'
        : `${stops.length} agents stopped: Claude rejected the sign-in`,
    body: 'Sign in again (claude /login) or switch the account, then Continue.',
    urgency: 'urgent',
    refKind: 'claude-auth-stop',
    refId: null,
    actions: [
      { id: PULSE_BELL_ACTION.continue, label: 'Continue' },
      { id: PULSE_BELL_ACTION.dismiss, label: 'Not now' }
    ],
    dedupeKey: `claude-auth-stop:${firstAt}`
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

/** The native chat a limit item names; see `limitStoppedChatBellItem`. */
export function readPulseBellSessionId(refId: string | null): string | null {
  try {
    const parsed: unknown = refId ? JSON.parse(refId) : null
    const sessionId: unknown =
      parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'sessionId') : null
    return typeof sessionId === 'string' ? sessionId : null
  } catch {
    return null
  }
}
