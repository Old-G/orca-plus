// Custom build (outgoing-approval): an agent tool call that reaches people or systems outside this
// machine, held until Gleb approves it in the bell.
import type { PulseDraftKind } from '../pulse-types'

export type OutgoingAction = {
  /** Who receives it: `Slack`, `ClickUp`, `git`, `ssh`, `HTTP`… */
  service: string
  /** What happens, in a few words: `send message`, `push`, `POST request`. */
  operation: string
  draftKind: PulseDraftKind
  /** Channel, task, host or recipient, when the call names one. */
  target: string | null
  /** The text the card shows — the message or the command. */
  body: string
  /** `tool_input` key that Edit replaces with the approved text; null means not editable. */
  editField: string | null
}

/** The held tool call, stored with its draft so a decision can answer the waiting hook. */
export type OutgoingDraftCall = {
  agent: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string | null
  sessionId: string | null
  cwd: string | null
  /** Terminal pane, when the agent runs in one. */
  paneKey: string | null
  /** Native chat session, when the agent runs in one. */
  agentSessionId: string | null
  service: string
  operation: string
  editField: string | null
}

export const MAX_OUTGOING_BODY_LENGTH = 20_000

export function readInputString(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const value: unknown = Reflect.get(input, key)
  return typeof value === 'string' ? value : null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Reads a stored call back; anything malformed reads as no call rather than a crash. */
export function parseOutgoingDraftCall(json: string | null): OutgoingDraftCall | null {
  if (!json) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') {
    return null
  }
  const field = (key: string): unknown => Reflect.get(value, key)
  const toolName = field('toolName')
  const toolInput = field('toolInput')
  if (
    typeof toolName !== 'string' ||
    !toolInput ||
    typeof toolInput !== 'object' ||
    Array.isArray(toolInput)
  ) {
    return null
  }
  return {
    agent: nullableString(field('agent')) ?? 'claude',
    toolName,
    toolInput: Object.fromEntries(Object.entries(toolInput)),
    toolUseId: nullableString(field('toolUseId')),
    sessionId: nullableString(field('sessionId')),
    cwd: nullableString(field('cwd')),
    paneKey: nullableString(field('paneKey')),
    agentSessionId: nullableString(field('agentSessionId')),
    service: nullableString(field('service')) ?? '',
    operation: nullableString(field('operation')) ?? '',
    editField: nullableString(field('editField'))
  }
}
