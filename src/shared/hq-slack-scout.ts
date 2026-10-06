// Custom build (hq-slack-scout): the Slack scout's files in the HQ folder. The scout (a skill on a
// 30-minute automation) writes drafts of tasks it found in Slack; HQ shows them, and the owner's
// Create or Reject is written back so the scout never drafts that thread again.
import { z } from 'zod'

export const HQ_SLACK_SCOUT_DIR = 'slack-scout'
export const HQ_SLACK_SCOUT_DRAFTS_FILE = 'drafts.json'
export const HQ_SLACK_SCOUT_DECISIONS_FILE = 'decisions.json'
export const HQ_SLACK_SCOUT_CONFIG_FILE = 'config.yaml'
/** Written by the scout's run.sh after every run: `{at, ok, exitCode, lastRunAt}`. */
export const HQ_SLACK_SCOUT_STATUS_FILE = 'status.json'

const SlackScoutStatus = z.object({ at: z.string().max(100), ok: z.boolean() })

/** When the last run failed (no Slack/ClickUp connector, a crash); null when it went fine or is unknown. */
export function parseHqSlackScoutFailedAt(text: string | null): string | null {
  if (!text) {
    return null
  }
  try {
    const parsed = SlackScoutStatus.safeParse(JSON.parse(text))
    return parsed.success && !parsed.data.ok ? parsed.data.at : null
  } catch {
    return null
  }
}

const SlackScoutDraft = z.object({
  /** `<channel id>:<thread ts>` — one draft per Slack thread. */
  id: z.string().min(1).max(200),
  channelName: z.string().max(200).default(''),
  author: z.string().max(200).default(''),
  permalink: z.string().max(2_000).default(''),
  /** What was written in Slack, quoted; someone else's text, shown as is. */
  quote: z.string().max(4_000).default(''),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).default(''),
  foundAt: z.string().max(100).default('')
})

export type HqSlackScoutDraft = z.infer<typeof SlackScoutDraft>

const SlackScoutDrafts = z.object({
  lastRunAt: z.string().max(100).optional(),
  drafts: z.array(z.unknown()).default([])
})

export type HqSlackScoutDraftsFile = { lastRunAt: string | null; drafts: HqSlackScoutDraft[] }

/** Drafts the scout wrote; a malformed draft is dropped alone, a malformed file reads as empty. */
export function parseHqSlackScoutDrafts(text: string): HqSlackScoutDraftsFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { lastRunAt: null, drafts: [] }
  }
  const file = SlackScoutDrafts.safeParse(raw)
  if (!file.success) {
    return { lastRunAt: null, drafts: [] }
  }
  return {
    lastRunAt: file.data.lastRunAt ?? null,
    drafts: file.data.drafts.flatMap((draft) => {
      const parsed = SlackScoutDraft.safeParse(draft)
      return parsed.success ? [parsed.data] : []
    })
  }
}

const SlackScoutDecision = z.object({
  decision: z.enum(['created', 'rejected']),
  at: z.number(),
  taskUrl: z.string().optional()
})

export type HqSlackScoutDecision = z.infer<typeof SlackScoutDecision>
export type HqSlackScoutDecisions = Record<string, HqSlackScoutDecision>

export function parseHqSlackScoutDecisions(text: string): HqSlackScoutDecisions {
  try {
    const parsed = z.record(z.string(), SlackScoutDecision).safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export type HqSlackScoutTaskTarget = {
  listId: string
  assigneeId: string | null
  status: string | null
}

/** `list_id`, `assignee_id`, `status` from config.yaml — flat `key: value` lines, comments allowed. */
export function parseHqSlackScoutTaskTarget(text: string): HqSlackScoutTaskTarget | null {
  const values = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^([a-z_]+):\s*["']?([^"'#]*?)["']?\s*(?:#.*)?$/.exec(line.trim())
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2].trim())
    }
  }
  const listId = values.get('list_id')
  return listId && /^\d+$/.test(listId)
    ? {
        listId,
        assigneeId: /^\d+$/.test(values.get('assignee_id') ?? '')
          ? (values.get('assignee_id') ?? null)
          : null,
        status: values.get('status') || null
      }
    : null
}

export type HqSlackScoutResult =
  | {
      ok: true
      configured: boolean
      lastRunAt: string | null
      /** The last run's time when it failed. */
      failedAt: string | null
      drafts: HqSlackScoutDraft[]
    }
  | { ok: false; error: string }

export type HqSlackScoutCreateResult = { ok: true; taskUrl: string } | { ok: false; error: string }

/** Drafts the owner has not decided yet. */
export function pendingHqSlackScoutDrafts(
  drafts: readonly HqSlackScoutDraft[],
  decisions: HqSlackScoutDecisions
): HqSlackScoutDraft[] {
  return drafts.filter((draft) => !decisions[draft.id])
}
