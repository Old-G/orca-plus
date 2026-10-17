// Custom build (pulse): params of the pulse.* RPC methods. Approving a draft and reporting its
// delivery are deliberately absent: an agent reaches this surface through the CLI, and it must
// never approve what it asked to send.
import { z } from 'zod'
import {
  OptionalFiniteNumber,
  OptionalPositiveInt,
  OptionalString,
  requiredString
} from './rpc-param-primitives'
import { HQ_FEED_SOURCES } from '../hq-feed'

const NullableText = z.string().nullable().optional()

export const PulseEventsParams = z.object({
  afterSeq: OptionalPositiveInt,
  limit: OptionalPositiveInt
})

export const PulseUpsertPersonParams = z.object({
  id: OptionalString,
  name: requiredString('Person name is required'),
  slackUserId: NullableText,
  clickupUserId: NullableText,
  role: NullableText,
  notes: NullableText
})

export const PulseListPeopleParams = z.object({ query: OptionalString }).optional()

export const PulseAddWaitingParams = z.object({
  direction: z.enum(['on-me', 'on-them']),
  title: requiredString('Waiting title is required'),
  personId: OptionalString,
  project: OptionalString,
  detail: OptionalString,
  source: requiredString('Waiting source is required'),
  sourceRef: OptionalString,
  dueAt: OptionalFiniteNumber,
  // Custom build (hq-waiting-replies): the chat that waits; the CLI reads them from the agent's env.
  agentSessionId: OptionalString,
  paneKey: OptionalString
})

export const PulseCloseWaitingParams = z.object({
  id: requiredString('Waiting id is required'),
  status: z.enum(['resolved', 'cancelled']),
  resolution: OptionalString
})

export const PulseListWaitingsParams = z
  .object({
    status: z.enum(['open', 'resolved', 'cancelled']).optional(),
    direction: z.enum(['on-me', 'on-them']).optional(),
    personId: OptionalString,
    project: OptionalString
  })
  .optional()

export const PulseAddDraftParams = z.object({
  kind: z.enum(['message', 'clickup-task', 'clickup-comment', 'other']),
  body: requiredString('Draft body is required'),
  target: OptionalString,
  title: OptionalString,
  project: OptionalString,
  personId: OptionalString,
  source: requiredString('Draft source is required'),
  sourceRef: OptionalString,
  fingerprint: OptionalString
})

export const PulseListDraftsParams = z
  .object({ status: z.enum(['pending', 'approved', 'rejected', 'sent', 'failed']).optional() })
  .optional()

export const PulseLogDecisionParams = z.object({
  title: requiredString('Decision title is required'),
  body: OptionalString,
  project: OptionalString,
  personId: OptionalString,
  source: requiredString('Decision source is required')
})

export const PulseListDecisionsParams = z.object({ limit: OptionalPositiveInt }).optional()

export const PulseAddInboxItemParams = z.object({
  kind: requiredString('Inbox item kind is required'),
  title: requiredString('Inbox item title is required'),
  body: OptionalString,
  urgency: z.enum(['normal', 'urgent']).optional(),
  refKind: OptionalString,
  refId: OptionalString,
  actions: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).optional(),
  dedupeKey: OptionalString
})

export const PulseListInboxParams = z
  .object({
    includeDone: z.boolean().optional(),
    // Custom build (hq-history): one kind since a time (epoch ms), for a log that only grows.
    kind: z.string().min(1).max(64).optional(),
    since: z.number().int().nonnegative().optional()
  })
  .optional()

export const PulseInboxItemRef = z.object({
  id: requiredString('Inbox item id is required'),
  action: OptionalString
})

/** Custom build (hq-feed): a page of HQ's feed. */
export const PulseFeedParams = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
    before: z.number().int().nonnegative().optional(),
    source: z.enum(HQ_FEED_SOURCES).optional(),
    project: z.string().min(1).max(200).optional(),
    query: z.string().max(200).optional()
  })
  .optional()
