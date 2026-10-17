// Custom build (hq-slack-scout): the Slack scout's files in the HQ folder. The scout (a skill on a
// 10-minute automation) writes requests to the owner it found in Slack; HQ shows them, and the owner's
// decision is written back so the scout never drafts that thread again.
import { z } from 'zod'
import type { HqSlackQuietItem } from './hq-slack-digest'

export const HQ_SLACK_SCOUT_DIR = 'slack-scout'
export const HQ_SLACK_SCOUT_DRAFTS_FILE = 'drafts.json'
export const HQ_SLACK_SCOUT_DECISIONS_FILE = 'decisions.json'
export const HQ_SLACK_SCOUT_CONFIG_FILE = 'config.yaml'
/** Custom build (hq-slack-requests): the owner's corrections to a request — kind, project, wording. */
export const HQ_SLACK_SCOUT_EDITS_FILE = 'edits.json'
/** Custom build (hq-clickup-requests): comments to the owner's ClickUp tasks, written by Orca+ itself. */
export const HQ_CLICKUP_REQUESTS_FILE = 'clickup.json'
/** Custom build (hq-clickup-requests): the owner's draft-vs-sent pairs, read back as tone examples. */
export const HQ_REPLY_CORRECTIONS_FILE = 'corrections.jsonl'
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

export const HQ_SLACK_REQUEST_KINDS = ['do', 'answer', 'fyi'] as const
export type HqSlackRequestKind = (typeof HQ_SLACK_REQUEST_KINDS)[number]

const SlackRequestKind = z.enum(HQ_SLACK_REQUEST_KINDS)

export const HqSlackScoutDraftSchema = z.object({
  /** `<channel id>:<thread ts>` — one draft per Slack thread. */
  id: z.string().min(1).max(200),
  channelName: z.string().max(200).default(''),
  author: z.string().max(200).default(''),
  permalink: z.string().max(2_000).default(''),
  /** What was written in Slack, quoted; someone else's text, shown as is. */
  quote: z.string().max(4_000).default(''),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).default(''),
  foundAt: z.string().max(100).default(''),
  // Custom build (hq-slack-requests): absent from drafts written before requests; a bad value is dropped alone.
  kind: SlackRequestKind.optional().catch(undefined),
  /** What the author wants from the owner, one line. */
  ask: z.string().max(500).optional().catch(undefined),
  /** HQ project slug, or null when the thread does not say. */
  project: z.string().max(200).nullable().optional().catch(undefined),
  authorId: z.string().max(50).optional().catch(undefined),
  /** Custom build (hq-clickup-requests): absent = Slack. */
  source: z.enum(['slack', 'clickup']).optional().catch(undefined),
  /** The ClickUp task a `clickup` request is a comment on. */
  clickupTaskId: z.string().max(100).optional().catch(undefined),
  /** Custom build (hq-scout-context): why this needs the owner, one line, after the scout's checks. */
  why: z.string().max(300).optional().catch(undefined),
  /** A blocker, a deadline today or a direct question long unanswered: the only kind that pops up. */
  urgent: z.boolean().optional().catch(undefined)
})

export type HqSlackScoutDraft = z.infer<typeof HqSlackScoutDraftSchema>

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
      const parsed = HqSlackScoutDraftSchema.safeParse(draft)
      return parsed.success ? [parsed.data] : []
    })
  }
}

/** A draft from before requests had a kind was always a task. */
export function hqSlackRequestKind(draft: Pick<HqSlackScoutDraft, 'kind'>): HqSlackRequestKind {
  return draft.kind ?? 'do'
}

export const HqSlackScoutDecisionSchema = z.object({
  decision: z.enum(['created', 'rejected', 'answered', 'taken']),
  at: z.number(),
  taskUrl: z.string().optional(),
  /** Custom build (hq-done-journal): what the request was, so the journal names it once it is gone. */
  title: z.string().max(300).optional().catch(undefined),
  author: z.string().max(200).optional().catch(undefined),
  source: z.enum(['slack', 'clickup']).optional().catch(undefined),
  permalink: z.string().max(2000).optional().catch(undefined)
})

export type HqSlackScoutDecision = z.infer<typeof HqSlackScoutDecisionSchema>
/** Custom build (hq-done-journal): one decision on a request, for «Done for you». */
export type HqSlackScoutDone = HqSlackScoutDecision & { id: string }

/** How far back «Done for you» looks. */
export const HQ_DONE_WINDOW_MS = 7 * 24 * 60 * 60_000
const DONE_MAX = 50

/** The last week's decisions, newest first. */
export function hqSlackScoutDone(
  decisions: HqSlackScoutDecisions,
  now: number
): HqSlackScoutDone[] {
  return Object.entries(decisions)
    .map(([id, decision]) => ({ ...decision, id }))
    .filter((entry) => entry.at > now - HQ_DONE_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, DONE_MAX)
}
export type HqSlackScoutDecisions = Record<string, HqSlackScoutDecision>

/** `{id: entry}` read entry by entry, so one entry a newer app wrote does not drop the rest. */
function parseRecordFile<T>(text: string, entry: z.ZodType<T>): Record<string, T> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const out: Record<string, T> = {}
  for (const [id, value] of Object.entries(raw)) {
    const parsed = entry.safeParse(value)
    if (parsed.success) {
      out[id] = parsed.data
    }
  }
  return out
}

export function parseHqSlackScoutDecisions(text: string): HqSlackScoutDecisions {
  return parseRecordFile(text, HqSlackScoutDecisionSchema)
}

const SlackScoutEdit = z.object({
  kind: SlackRequestKind.optional(),
  project: z.string().max(200).nullable().optional(),
  ask: z.string().max(500).optional(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20_000).optional()
})

export type HqSlackScoutEdit = z.infer<typeof SlackScoutEdit>
export type HqSlackScoutEdits = Record<string, HqSlackScoutEdit>

export function parseHqSlackScoutEdits(text: string): HqSlackScoutEdits {
  return parseRecordFile(text, SlackScoutEdit)
}

/** The scout's drafts with the owner's corrections laid over them. */
export function applyHqSlackScoutEdits(
  drafts: readonly HqSlackScoutDraft[],
  edits: HqSlackScoutEdits
): HqSlackScoutDraft[] {
  return drafts.map((draft) => {
    const edit = edits[draft.id]
    return edit ? { ...draft, ...edit } : draft
  })
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

/** Custom build (hq-scout-quiet): how loud the requests are, from config.yaml. */
export type HqSlackScoutTuning = {
  /** ClickUp accounts whose comments are never requests — the agents' own account. */
  clickUpIgnoreAuthors: string[]
  /** A request nobody decided disappears after this many days. */
  cardTtlDays: number
  /** Local hours the Slack digest lands in the bell. */
  digestHours: number[]
}

export const DEFAULT_HQ_CARD_TTL_DAYS = 3
export const DEFAULT_HQ_DIGEST_HOURS = [10, 14, 18]

function configValues(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^([a-z_]+):\s*([^#]*?)\s*(?:#.*)?$/.exec(line.trim())
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2])
    }
  }
  return values
}

/** `clickup_ignore_authors: [50190479]`, `card_ttl_days: 3`, `digest_hours: [10, 14, 18]`; anything
 *  unreadable keeps the default. */
export function parseHqSlackScoutTuning(text: string): HqSlackScoutTuning {
  const values = configValues(text)
  const ignore = values.get('clickup_ignore_authors') ?? ''
  const ttl = Number(values.get('card_ttl_days'))
  const hours = [...(values.get('digest_hours') ?? '').matchAll(/\d+/g)]
    .map((match) => Number(match[0]))
    .filter((hour) => hour >= 0 && hour <= 23)
  return {
    clickUpIgnoreAuthors: [...ignore.matchAll(/\d+/g)].map((match) => match[0]),
    cardTtlDays: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_HQ_CARD_TTL_DAYS,
    digestHours: values.has('digest_hours') ? hours.sort((a, b) => a - b) : DEFAULT_HQ_DIGEST_HOURS
  }
}

/** A request is shown for `cardTtlDays` after it was found; an older one has gone quiet. */
export function freshHqSlackScoutDraft(
  draft: Pick<HqSlackScoutDraft, 'foundAt'>,
  tuning: HqSlackScoutTuning,
  now: number
): boolean {
  const found = Date.parse(draft.foundAt ?? '')
  return !Number.isFinite(found) || now - found <= tuning.cardTtlDays * 24 * 60 * 60_000
}

export type HqSlackScoutResult =
  | {
      ok: true
      configured: boolean
      lastRunAt: string | null
      /** The last run's time when it failed. */
      failedAt: string | null
      drafts: HqSlackScoutDraft[]
      /** Custom build (hq-done-journal): the last week's decisions; absent from older hosts. */
      done?: HqSlackScoutDone[]
      /** Custom build (hq-scout-digest): what the scout set aside as quiet, newest first. */
      quiet?: HqSlackQuietItem[]
    }
  | { ok: false; error: string }

export type HqSlackScoutCreateResult =
  | { ok: true; taskUrl: string; taskId?: string }
  | { ok: false; error: string }

/** Drafts the owner has not decided yet. */
export function pendingHqSlackScoutDrafts(
  drafts: readonly HqSlackScoutDraft[],
  decisions: HqSlackScoutDecisions
): HqSlackScoutDraft[] {
  return drafts.filter((draft) => !decisions[draft.id])
}
