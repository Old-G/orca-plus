// Custom build (hq-feed): HQ's feed — one timeline of what happened around the owner (Slack
// conversations and requests, ClickUp comments, reviews waiting on him, what Orca+ sent for him),
// each with its project and person where known. Read-only; kept in orca-plus-pulse.db.
import { z } from 'zod'

export const HQ_FEED_SOURCES = ['slack', 'clickup', 'git', 'orca'] as const
export type HqFeedSource = (typeof HQ_FEED_SOURCES)[number]

export const HqFeedItemSchema = z.object({
  /** Unique per thing in its source (`slack:<topic>`, `clickup:<task>:<comment>`…): a repeat updates it. */
  id: z.string().min(1).max(500),
  source: z.enum(HQ_FEED_SOURCES),
  /** What kind of event: `conversation`, `request`, `fyi`, `comment`, `my-comment`, `review`, `sent`. */
  kind: z.string().min(1).max(40),
  at: z.number().int().nonnegative(),
  title: z.string().min(1).max(300),
  body: z.string().max(2000).nullable(),
  url: z.string().max(1000).nullable(),
  project: z.string().max(200).nullable(),
  person: z.string().max(200).nullable()
})
export type HqFeedItem = z.infer<typeof HqFeedItemSchema>

export type HqFeedQuery = {
  limit?: number
  /** Items older than this (epoch ms), for paging back. */
  before?: number
  source?: HqFeedSource
  project?: string
  /** Words in the title, body or person. */
  query?: string
}

/** The feed as a client reads it; an entry a newer host wrote is dropped alone. */
export function readHqFeed(raw: unknown): HqFeedItem[] {
  const items = raw && typeof raw === 'object' ? Reflect.get(raw, 'items') : null
  return (Array.isArray(items) ? items : []).flatMap((entry: unknown) => {
    const parsed = HqFeedItemSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/** Only web links open from the feed; the files behind it are written from other people's text. */
export function hqFeedUrl(url: string | null | undefined): string | null {
  return url && /^https:\/\/[^\s]+$/.test(url) ? url : null
}
