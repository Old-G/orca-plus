// Custom build (chat-auto-effort-roles): what a chat's role and a message's sender mean for its effort.
// A head chat (lead, sub-lead) and a reviewer always work at medium and never ask the classifier;
// a message relayed from another chat or a lead's brief keeps the effort the chat already has.
// Only the owner's own message in a worker chat (or a chat with no role) goes to the classifier.
import type { HqChatRole } from '../../../shared/hq-chat-role'
import type { AutoEffortLevel } from './native-chat-auto-effort'

export type ChatRole = HqChatRole

// Why: the plan's contract — a lead and a sub-lead are Opus medium, a reviewer is medium too.
const FIXED_EFFORT: Partial<Record<ChatRole, AutoEffortLevel>> = {
  lead: 'medium',
  sublead: 'medium',
  review: 'medium'
}

export function fixedRoleEffort(role: ChatRole | null): AutoEffortLevel | null {
  return role ? (FIXED_EFFORT[role] ?? null) : null
}

// Why: `orca chat send` wraps what it hands over in this head; a lead's brief opens with its marker
// or the chat's role label, and it reaches a new chat through the composer as if typed. Escaped:
// orcad's bundle must stay ASCII (« · », «От лида»).
const RELAYED_HEADS = [
  /^Orca\+ \u00b7 a message from thread /,
  /^\u041e\u0442 \u043b\u0438\u0434\u0430(?!\p{L})/u,
  /^Lead:/,
  /^(?:LEAD|Lead|SUB-LEAD|W|REVIEW) \u00b7 /
]

/** True for text another chat or a lead wrote, whoever typed it in. */
export function isRelayedText(text: string): boolean {
  const head = text.trimStart()
  return RELAYED_HEADS.some((pattern) => pattern.test(head))
}

export type EffortRoute =
  | { kind: 'fixed'; effort: AutoEffortLevel }
  | { kind: 'relayed' }
  | { kind: 'ask' }

/** Where a message's effort comes from: its chat's role, its sender, or the classifier. */
export function effortRoute(input: {
  role: ChatRole | null
  /** False when the journal knows the message is not the person's (a queued relay, agent mail). */
  fromPerson: boolean
  text: string
}): EffortRoute {
  const fixed = fixedRoleEffort(input.role)
  if (fixed) {
    return { kind: 'fixed', effort: fixed }
  }
  if (!input.fromPerson || isRelayedText(input.text)) {
    return { kind: 'relayed' }
  }
  return { kind: 'ask' }
}

// Why: until chats carry their role, a lead is known by its plan file's line
// «Lead chat: <address> (<sessionId>…) · started …» in HQ/runs/*.md (plan decision 14.11).
const LEAD_LINE = /^Lead chat:[^\n(]*\((claude_[0-9a-f_]+)/gm

/** Session ids of the leads the plan files name. */
export function leadSessionIdsFromPlans(texts: readonly string[]): Set<string> {
  const ids = new Set<string>()
  for (const text of texts) {
    for (const match of text.matchAll(LEAD_LINE)) {
      if (match[1]) {
        ids.add(match[1])
      }
    }
  }
  return ids
}
