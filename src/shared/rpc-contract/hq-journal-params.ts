// Custom build (hq-plus-journal): params of `hq.events` and `hq.whoami`. The caller fields come
// from the agent's environment; the host decides from them which room the caller may read.
import { z } from 'zod'
import { OptionalFiniteNumber, OptionalPositiveInt, OptionalString } from './rpc-param-primitives'

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
  room: OptionalString
})
