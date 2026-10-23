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
  since: OptionalFiniteNumber
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
