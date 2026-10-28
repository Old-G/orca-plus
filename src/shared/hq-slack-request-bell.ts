// Custom build (hq-slack-requests): a Slack request the scout found, as a bell item — who asks, what,
// for which project — with the owner's four answers. The item closes once HQ records a decision.
import {
  hqSlackRequestKind,
  type HqSlackRequestKind,
  type HqSlackScoutDraft
} from './hq-slack-scout'
import type { HqProjectPage } from './hq-project-pages'
import type { PulseBellInput } from './pulse-bell'
import { hqSourceService } from './hq-source-link'

export const HQ_SLACK_REQUEST_BELL_KIND = 'slack-request'

export const HQ_SLACK_REQUEST_ACTION = {
  do: 'slack-do',
  answer: 'slack-answer',
  edit: 'slack-edit',
  skip: 'slack-skip',
  /** Custom build (hq-clickup-review): «Разобрать». */
  review: 'slack-review'
} as const

const KIND_LABEL: Record<HqSlackRequestKind, string> = {
  do: 'Do',
  answer: 'Reply',
  fyi: 'FYI'
}

const ACTIONS = {
  do: { id: HQ_SLACK_REQUEST_ACTION.do, label: 'Do' },
  answer: { id: HQ_SLACK_REQUEST_ACTION.answer, label: 'Just reply' },
  edit: { id: HQ_SLACK_REQUEST_ACTION.edit, label: 'Edit' },
  skip: { id: HQ_SLACK_REQUEST_ACTION.skip, label: 'Skip' },
  review: { id: HQ_SLACK_REQUEST_ACTION.review, label: 'Investigate' }
}

/** The suggested answer comes first; an FYI is mostly just read. */
const ACTION_ORDER: Record<HqSlackRequestKind, Exclude<keyof typeof ACTIONS, 'review'>[]> = {
  do: ['do', 'answer', 'edit', 'skip'],
  answer: ['answer', 'do', 'edit', 'skip'],
  fyi: ['skip', 'do', 'answer', 'edit']
}

/** `Billing — робот-…` → `Billing`. */
export function hqProjectShortName(page: Pick<HqProjectPage, 'slug' | 'title'>): string {
  return page.title?.split(' — ')[0]?.trim() || page.slug
}

export type HqSlackRequestRef = { id: string; kind: HqSlackRequestKind; link?: string }

/** The Slack message or ClickUp task a request came from, when the scout recorded it. */
function sourceLinkOf(draft: HqSlackScoutDraft): string | null {
  const permalink = draft.permalink?.trim()
  if (permalink && hqSourceService(permalink)) {
    return permalink
  }
  return draft.clickupTaskId
    ? `https://app.clickup.com/t/${encodeURIComponent(draft.clickupTaskId)}`
    : null
}

/** Short stable hash, so a corrected request replaces its bell item instead of keeping the old text. */
function contentKey(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function slackRequestBellItem(
  draft: HqSlackScoutDraft,
  projectName: string | null
): PulseBellInput {
  const kind = hqSlackRequestKind(draft)
  const ask = (draft.ask || draft.title).replace(/\s+/g, ' ').trim()
  const meta = [KIND_LABEL[kind], projectName ?? 'project?', draft.channelName]
    .filter(Boolean)
    .join(' · ')
  const quote = draft.quote.replace(/\s+/g, ' ').trim()
  const why = draft.why?.replace(/\s+/g, ' ').trim()
  // Custom build (hq-plus-ui-v5): where the request lives, so its card can open the thread or task.
  const link = sourceLinkOf(draft)
  const ref: HqSlackRequestRef = { id: draft.id, kind, ...(link ? { link } : {}) }
  const title = draft.author ? `${draft.author}: ${ask}` : ask
  // Custom build (hq-plus-cards): what the person wrote, then the scout's reason it needs the owner —
  // both, so the card says what the talk is about without opening Slack.
  const body = [meta, quote ? `«${quote.slice(0, 400)}»` : null, why ? `→ ${why.slice(0, 200)}` : null]
    .filter(Boolean)
    .join('\n')
  return {
    kind: HQ_SLACK_REQUEST_BELL_KIND,
    title,
    body,
    urgency: draft.urgent ? 'urgent' : 'normal',
    refKind: 'slack-request',
    refId: JSON.stringify(ref),
    actions: [
      ...(draft.needsReview && !draft.review ? [ACTIONS.review] : []),
      ...ACTION_ORDER[kind].map((key) =>
        kind === 'fyi' && key === 'skip' ? { ...ACTIONS.skip, label: 'Got it' } : ACTIONS[key]
      )
    ],
    dedupeKey: `slack-request:${draft.id}:${contentKey(`${title}\n${body}`)}`
  }
}

export function readHqSlackRequestRef(refId: string | null): HqSlackRequestRef | null {
  try {
    const parsed: unknown = refId ? JSON.parse(refId) : null
    const id: unknown = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'id') : null
    const kind: unknown = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'kind') : null
    return typeof id === 'string' && (kind === 'do' || kind === 'answer' || kind === 'fyi')
      ? { id, kind }
      : null
  } catch {
    return null
  }
}
