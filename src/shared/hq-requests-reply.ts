// Custom build (hq-mobile): HQ's requests as `hqProjects.slackDrafts` returns them, read entry by
// entry so one entry a newer host wrote does not drop the rest — for clients off the Mac (the phone).
import { z } from 'zod'
import {
  HqSlackScoutDecisionSchema,
  HqSlackScoutDraftSchema,
  type HqSlackScoutDone,
  type HqSlackScoutDraft
} from './hq-slack-scout'

export const HqRequestsReplySchema = z.union([
  z.object({
    ok: z.literal(true),
    drafts: z.array(z.unknown()),
    done: z.array(z.unknown()).optional()
  }),
  z.object({ ok: z.literal(false), error: z.string() })
])

export type HqRequests = { drafts: HqSlackScoutDraft[]; done: HqSlackScoutDone[] }

const DoneSchema = HqSlackScoutDecisionSchema.extend({ id: z.string().min(1).max(200) })

export function readHqRequests(
  reply: z.infer<typeof HqRequestsReplySchema>
): HqRequests | { error: string } {
  if (!reply.ok) {
    return { error: reply.error }
  }
  return {
    drafts: reply.drafts.flatMap((entry) => {
      const parsed = HqSlackScoutDraftSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
    done: (reply.done ?? []).flatMap((entry) => {
      const parsed = DoneSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    })
  }
}

/** The reply of HQ's writes: a decision recorded, a comment posted, a request handed to the Mac. */
export const HqWriteReplySchema = z.union([
  z.object({ ok: z.literal(true) }).passthrough(),
  z.object({ ok: z.literal(false), error: z.string() })
])

export const HqDraftReplySchema = z.union([
  z.object({ ok: z.literal(true), text: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() })
])
