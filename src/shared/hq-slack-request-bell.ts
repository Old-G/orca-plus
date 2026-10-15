// Custom build (hq-slack-requests): a Slack request the scout found, as a bell item — who asks, what,
// for which project — with the owner's four answers. The item closes once HQ records a decision.
import {
  hqSlackRequestKind,
  type HqSlackRequestKind,
  type HqSlackScoutDraft
} from './hq-slack-scout'
import type { HqProjectPage } from './hq-project-pages'
import type { PulseBellInput } from './pulse-bell'

export const HQ_SLACK_REQUEST_BELL_KIND = 'slack-request'

export const HQ_SLACK_REQUEST_ACTION = {
  do: 'slack-do',
  answer: 'slack-answer',
  edit: 'slack-edit',
  skip: 'slack-skip'
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
  skip: { id: HQ_SLACK_REQUEST_ACTION.skip, label: 'Skip' }
}

/** The suggested answer comes first; an FYI is mostly just read. */
const ACTION_ORDER: Record<HqSlackRequestKind, (keyof typeof ACTIONS)[]> = {
  do: ['do', 'answer', 'edit', 'skip'],
  answer: ['answer', 'do', 'edit', 'skip'],
  fyi: ['skip', 'do', 'answer', 'edit']
}

/** `Billing — робот-…` → `Billing`. */
export function hqProjectShortName(page: Pick<HqProjectPage, 'slug' | 'title'>): string {
  return page.title?.split(' — ')[0]?.trim() || page.slug
}

export type HqSlackRequestRef = { id: string; kind: HqSlackRequestKind }

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
  const ref: HqSlackRequestRef = { id: draft.id, kind }
  const title = draft.author ? `${draft.author}: ${ask}` : ask
  const body = quote ? `${meta}\n«${quote.slice(0, 200)}»` : meta
  return {
    kind: HQ_SLACK_REQUEST_BELL_KIND,
    title,
    body,
    refKind: 'slack-request',
    refId: JSON.stringify(ref),
    actions: ACTION_ORDER[kind].map((key) =>
      kind === 'fyi' && key === 'skip' ? { ...ACTIONS.skip, label: 'Got it' } : ACTIONS[key]
    ),
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
