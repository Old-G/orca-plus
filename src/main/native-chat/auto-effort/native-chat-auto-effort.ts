// Custom build (chat-auto-effort): a Claude chat's effort follows each message the person sends —
// low for a trivial reply, medium for a quick step, high for ordinary work, xhigh for hard or risky
// work — picked by a small
// classifier as the message is handed over. Any miss keeps the effort the chat already has.
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { ChatAutoEffortOutcome } from '../../../shared/chat-auto-effort-status'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { chatModelEffortLevels } from './chat-model-effort-levels'

export const AUTO_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const
export type AutoEffortLevel = (typeof AUTO_EFFORT_LEVELS)[number]

// Why: a level outside the range was picked by hand on purpose; the classifier leaves it alone.
// Low is in the range: a pick is saved as the chat's effort, and a low one must not stop the next.
const HAND_PICKED_EFFORTS = new Set(['none', 'minimal', 'max'])

type MessageOptions = AgentJournalSubmission['options']

export type NativeChatAutoEffortService = {
  enabled: () => boolean
  key: () => string | null
  pick: (input: {
    key: string
    message: string
    previousAgentMessage: string | null
  }) => Promise<AutoEffortLevel | null>
}

let service: NativeChatAutoEffortService | null = null

/** One message's outcome, so Settings can show that the switch is doing something. */
export type AutoEffortOutcome = ChatAutoEffortOutcome

const OUTCOMES_KEPT = 5
const outcomes: AutoEffortOutcome[] = []

function noteOutcome(outcome: AutoEffortOutcome): void {
  outcomes.unshift(outcome)
  outcomes.length = Math.min(outcomes.length, OUTCOMES_KEPT)
  console.info(`[chat-auto-effort] ${outcome.result} → ${outcome.effort ?? 'chat default'}`)
}

/** Custom build (hq-plus-ladder): every message's effort, for the journal — a hand pick included. */
export type AutoEffortLogEntry = {
  sessionId: string | null
  messageId: string | null
  at: number
  effort: string | null
  result: AutoEffortOutcome['result'] | 'hand-picked'
  message: string
}

let log: ((entry: AutoEffortLogEntry) => void) | null = null

export function provideAutoEffortLog(next: ((entry: AutoEffortLogEntry) => void) | null): void {
  log = next
}

/** Newest first. */
export function recentAutoEffortOutcomes(): readonly AutoEffortOutcome[] {
  return outcomes
}

export function provideNativeChatAutoEffort(next: NativeChatAutoEffortService | null): void {
  service = next
}

function messageText(body: AgentJournalItemBody | undefined, role: 'user' | 'assistant'): string {
  if (body?.kind !== 'message' || body.role !== role) {
    return ''
  }
  return body.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
}

function lastAgentMessage(items: readonly AgentJournalRenderItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = messageText(items[index]?.body, 'assistant')
    if (text) {
      return text
    }
  }
  return null
}

/** The options a person's message is handed over with: its own, effort replaced by the pick. */
export async function autoEffortMessageOptions(input: {
  provider: string
  options: MessageOptions
  body: AgentJournalItemBody | undefined
  items: () => readonly AgentJournalRenderItem[]
  /** Levels the message's model offers; null when the model list does not say. */
  effortLevels?: () => ReadonlySet<string> | null
  sessionId?: string | null
  messageId?: string | null
}): Promise<MessageOptions> {
  const current = service
  if (!current || input.provider !== 'claude' || !current.enabled()) {
    return input.options
  }
  if (input.body?.kind === 'message' && input.body.command) {
    return input.options
  }
  const message = messageText(input.body, 'user')
  const handPicked = input.options?.effort
  const logged = (result: AutoEffortLogEntry['result'], effort: string | null): void =>
    log?.({
      sessionId: input.sessionId ?? null,
      messageId: input.messageId ?? null,
      at: Date.now(),
      effort,
      result,
      message: message.slice(0, 80)
    })
  if (!message || (handPicked && HAND_PICKED_EFFORTS.has(handPicked))) {
    if (message && handPicked) {
      logged('hand-picked', handPicked)
    }
    return input.options
  }
  const note = (result: AutoEffortOutcome['result'], effort: string | null): void => {
    noteOutcome({ at: Date.now(), effort, result, message: message.slice(0, 80) })
    logged(result, effort)
  }
  // Why: a model with no effort control (Haiku) would refuse the pick, or fail the start it rides on.
  const levels = input.effortLevels?.() ?? null
  if (levels && !AUTO_EFFORT_LEVELS.some((level) => levels.has(level))) {
    note('no-effort-control', handPicked ?? null)
    return input.options
  }
  const key = current.key()
  if (!key) {
    note('no-key', handPicked ?? null)
    return input.options
  }
  const level = await current.pick({
    key,
    message,
    previousAgentMessage: lastAgentMessage(input.items())
  })
  const usable = level && (!levels || levels.has(level)) ? level : null
  note(usable ? 'picked' : 'no-answer', usable ?? handPicked ?? null)
  return usable ? { ...input.options, effort: usable } : input.options
}

// Why: a message's options are applied before its agent starts and again at handover; ask once.
const picked = new Map<string, Promise<MessageOptions>>()
const PICKED_KEPT = 50

/** The delivery loop's hook: a queued message's options with the picked effort. */
export function withAutoEffort(
  submission: AgentJournalSubmission,
  record: AgentSessionRecord | null,
  journal: AgentSessionJournal | undefined
): Promise<MessageOptions> {
  const options = submission.options
  const provider = record?.provider
  if (!journal || !provider || !service?.enabled()) {
    return Promise.resolve(options)
  }
  const id = submission.clientMessageId
  const known = picked.get(id)
  if (known) {
    return known
  }
  const pending = autoEffortMessageOptions({
    provider,
    options,
    body: journal.itemBody(agentJournalSubmissionKey(id)) ?? undefined,
    items: () => journal.snapshot().items,
    effortLevels: () => chatModelEffortLevels(record, options?.model),
    sessionId: record?.sessionId ?? null,
    messageId: id
  })
  picked.set(id, pending)
  if (picked.size > PICKED_KEPT) {
    picked.delete(picked.keys().next().value ?? id)
  }
  return pending
}
