// Custom build (hq-plus-journal): params of `hq.events` and `hq.whoami`. The caller fields come
// from the agent's environment; the host decides from them which room the caller may read.
import { z } from 'zod'
import {
  OptionalBoolean,
  OptionalFiniteNumber,
  OptionalPositiveInt,
  OptionalString,
  requiredString
} from './rpc-param-primitives'

const CallerFields = {
  callerSessionId: OptionalString,
  callerWorktreeId: OptionalString,
  callerCwd: OptionalString
}

export const HqWhoamiParams = z.object(CallerFields)

export const HqEventsParams = z.object({
  ...CallerFields,
  since: OptionalFiniteNumber,
  project: OptionalString,
  needs: OptionalString,
  kind: OptionalString,
  limit: OptionalPositiveInt,
  /** One room's whole entries; only HQ+ may ask, and the read is journaled. */
  room: OptionalString,
  /** Custom build (hq-plus-ask): words every row must hold. */
  query: OptionalString
})

// Custom build (hq-plus-reports)
export const HqReportParams = z.object({
  ...CallerFields,
  done: requiredString('--done is required: what this turn did, in one line'),
  ask: OptionalString,
  options: z.array(z.string().max(200)).max(10).optional(),
  next: OptionalString,
  blockedBy: OptionalString,
  links: z.array(z.string().max(1000)).max(20).optional(),
  address: OptionalString
})

export const HqThreadParams = z.object({ ...CallerFields, address: OptionalString })

export const ChatSendParams = z.object({
  ...CallerFields,
  address: requiredString('A thread address is required: <project>/<task>'),
  text: requiredString('A message is required'),
  replyTo: OptionalString
})

// Custom build (hq-plus-routing)
export const HqRouteParams = z.object({
  ...CallerFields,
  /** Carry the actions out; absent, it only says what it would do. */
  run: OptionalBoolean,
  /** Ignore the rule's hour and the Claude limit, as a run by hand does. */
  now: OptionalBoolean,
  since: OptionalFiniteNumber,
  /** Custom build (hq-fix-now-all): «Fix now» on this report — every finding no chat has yet. */
  report: OptionalString
})

// Custom build (hq-plus-ladder): the trust ladder's counts since a moment.
export const HqLadderParams = z.object({
  ...CallerFields,
  since: OptionalFiniteNumber
})

// Custom build (hq-fix-now-all): one merge per project at a time among chats working side by side.
export const HqMergeSlotParams = z.object({
  ...CallerFields,
  project: requiredString('A project is required'),
  action: z.enum(['take', 'release', 'status'])
})

export const HqSettleParams = z.object({
  ...CallerFields,
  id: requiredString('A journal entry id is required'),
  status: z.enum(['done', 'dropped']),
  commit: OptionalString,
  why: OptionalString
})

// Custom build (hq-plus-context)
export const HqContextParams = z.object({
  ...CallerFields,
  project: OptionalString,
  /** What a new chat is told: the room's notes and its project's card. */
  sessionStart: OptionalBoolean
})

export const HqStepParams = z.object({
  ...CallerFields,
  project: OptionalString,
  id: requiredString('A plan step id is required, e.g. 2.3'),
  done: z.boolean()
})

export const HqWhereParams = z.object({
  ...CallerFields,
  question: requiredString('A question is required')
})

export const HqWorkspaceAddParams = z.object({
  ...CallerFields,
  name: requiredString('A room name is required'),
  slug: OptionalString,
  color: OptionalString,
  messenger: OptionalString,
  tasks: OptionalString
})

// Custom build (hq-plus-sessions): the session dispatcher.
export const HqDispatchParams = z.object({
  ...CallerFields,
  address: requiredString('A thread address (<project>/<task>) is required'),
  prompt: requiredString('The work (--prompt) is required'),
  /** Only say what it would do. */
  dryRun: OptionalBoolean
})

export const HqSessionsParams = z.object({
  ...CallerFields,
  /** Carry out what the sweep finds now (mode on); absent, it only lists. */
  run: OptionalBoolean
})

// Custom build (hq-plus-ui): the owner's HQ+ screen reads every room's whole rows at once.
export const HqFeedParams = z.object({
  since: OptionalFiniteNumber,
  limit: OptionalPositiveInt
})

// Custom build (hq-ledger-feed): the owner fixes a conversation's project from its card's chip.
export const HqConversationProjectParams = z.object({
  key: requiredString('A conversation key is required'),
  project: requiredString('A project is required')
})

// Custom build (hq-project-cards): «Skip» on a chat's question the owner no longer needs to answer.
export const HqSkipOwnerParams = z.object({
  id: requiredString('A journal row id is required')
})

// Custom build (hq-ledger-sources): «Done» on the card of an MR or a mail thread.
export const HqConversationDoneParams = z.object({
  key: requiredString('A conversation key is required')
})

// Custom build (hq-ledger-cutover): «To work» on a conversation card — its «To work» card, made if none.
export const HqConversationToWorkParams = z.object({
  key: requiredString('A conversation key is required')
})

// Custom build (hq-in-work, plan 20.11): «Not in work» on a conversation a chat was thought to do.
export const HqConversationNotInWorkParams = z.object({
  conversationId: requiredString('A conversation id is required')
})

// Custom build (hq-attribution-log, owner 03.11): the owner sent a conversation to work — what its card
// proposed and what he chose, so the guess is counted kept or changed.
export const HqAttributionTakeParams = z.object({
  key: requiredString('A conversation key is required'),
  proposedProject: z.string().trim().min(1).nullable(),
  proposedChat: requiredString('The proposed chat is required (a session id or "new")'),
  project: z.string().trim().min(1).nullable(),
  chat: requiredString('The chosen chat is required (a session id or "new")'),
  // Custom build (owner 03.11): the card's kind and his reason, when «To work» showed them.
  proposedKind: z.enum(['do', 'answer', 'reply', 'fyi']).nullable().optional(),
  kind: z.enum(['do', 'answer', 'reply', 'fyi']).optional(),
  why: z.string().trim().max(500).optional()
})

// Custom build (hq-attribution-log): the owner dropped a conversation's card.
export const HqAttributionSkipParams = z.object({
  key: requiredString('A conversation key is required')
})

// Custom build (hq-attribution-log): how often guesses were kept, over the last N days.
export const HqAccuracyParams = z.object({
  days: OptionalPositiveInt
})

// Custom build (hq-closed-loop): a background job's report — what it found, what it asks the owner,
// what it did by itself. Not a chat, so no caller: the job names itself and, when it has one, the project.
export const HqJobParams = z
  .object({
    job: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, '--job is a short name: a-z, 0-9 and -'),
    found: OptionalString,
    ask: OptionalString,
    options: z.array(z.string().max(200)).max(10).optional(),
    did: OptionalString,
    learned: OptionalString,
    links: z.array(z.string().max(1000)).max(20).optional(),
    project: OptionalString
  })
  .refine((input) => Boolean(input.found || input.ask || input.did || input.learned), {
    message: 'Say what the job found (--found), asks (--ask), did (--did) or learned (--learned)'
  })

/** Custom build (hq-closed-loop): the owner's answer on a background job's card in HQ+. */
export const HqJobReplyParams = z.object({
  entryId: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(2000)
})

/** Custom build (hq-closed-loop): `orca hq person <name|@handle|id>` and `orca hq who <project>`. */
export const HqPersonLookupParams = z.object({ query: z.string().trim().min(1).max(200) })
export const HqWhoParams = z.object({ project: z.string().trim().min(1).max(200) })

// Custom build (hq-plus-chat-tree): a chat that ran `orca agent launch` names the chat it started; the
// caller's own session is the parent. HQ+ reads every link to draw its «By work» tree.
export const HqLinkChatParams = z.object({
  ...CallerFields,
  sessionId: requiredString('The started chat’s session id is required')
})
export const HqChatLinksParams = z.object({})

// Custom build (hq-plus-brain): a task, an MR, a person, a project or words for HQ+'s «Brain».
export const HqBrainParams = z.object({
  query: requiredString('A task, an MR, a person, a project or words are required')
})
