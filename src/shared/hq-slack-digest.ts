// Custom build (hq-scout-digest): the Slack digest — what waits for the owner and what went by quietly
// since the last one — as one bell item at the hours config.yaml names, instead of a pop-up per message.
import type { HqSlackScoutDraft } from './hq-slack-scout'
import type { PulseBellInput } from './pulse-bell'

export const HQ_SLACK_DIGEST_KIND = 'slack-digest'
export const HQ_SLACK_DIGEST_OPEN_ACTION = 'open'
export const HQ_SLACK_QUIET_FILE = 'quiet.json'

export type HqSlackQuietItem = {
  id: string
  at: string
  author: string | null
  channelName: string | null
  summary: string
  why: string | null
  permalink: string | null
}

const LISTED = 5
const LINE_MAX = 140

function line(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > LINE_MAX ? `${flat.slice(0, LINE_MAX - 1)}…` : flat
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Why: the scout writes these from Slack; only a Slack or ClickUp https link may become a button.
function safeLink(link: string | null): string | null {
  return link && /^https:\/\/([a-z0-9-]+\.)*(slack\.com|clickup\.com)\//i.test(link) ? link : null
}

/** The scout's quiet.json; anything malformed is dropped alone. */
export function parseHqSlackQuiet(json: string): HqSlackQuietItem[] {
  let file: unknown
  try {
    file = JSON.parse(json)
  } catch {
    return []
  }
  const items = file && typeof file === 'object' ? Reflect.get(file, 'items') : null
  return (Array.isArray(items) ? items : []).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const id = text(Reflect.get(entry, 'id'))
    const at = text(Reflect.get(entry, 'at'))
    const summary = text(Reflect.get(entry, 'summary'))
    return id && at && summary
      ? [
          {
            id,
            at,
            summary,
            author: text(Reflect.get(entry, 'author')),
            channelName: text(Reflect.get(entry, 'channelName')),
            why: text(Reflect.get(entry, 'why')),
            permalink: safeLink(text(Reflect.get(entry, 'permalink')))
          }
        ]
      : []
  })
}

/** `YYYY-MM-DD HH` of the latest digest hour already reached today, local time; null before the first. */
export function hqDigestSlot(now: Date, hours: readonly number[]): string | null {
  const hour = hours.toReversed().find((candidate) => candidate <= now.getHours())
  if (hour === undefined) {
    return null
  }
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${day} ${String(hour).padStart(2, '0')}`
}

/** Null when nothing waits and nothing went by — a digest of nothing is noise too. */
export function hqSlackDigestItem(
  slot: string,
  waiting: readonly HqSlackScoutDraft[],
  quiet: readonly HqSlackQuietItem[]
): PulseBellInput | null {
  if (waiting.length === 0 && quiet.length === 0) {
    return null
  }
  const lines: string[] = []
  if (waiting.length > 0) {
    lines.push(`Wait for you: ${waiting.length}`)
    for (const draft of waiting.slice(0, LISTED)) {
      lines.push(
        `• ${line(`${draft.author ? `${draft.author}: ` : ''}${draft.ask || draft.title}`)}`
      )
    }
  }
  if (quiet.length > 0) {
    lines.push(`Went by quietly: ${quiet.length}`)
    for (const item of quiet.slice(-LISTED)) {
      const who = item.author ? `${item.author}: ` : ''
      lines.push(`• ${line(`${who}${item.summary}${item.why ? ` (${item.why})` : ''}`)}`)
    }
  }
  return {
    kind: HQ_SLACK_DIGEST_KIND,
    title: `Slack digest ${slot.slice(-2)}:00 — ${waiting.length} for you, ${quiet.length} quiet`,
    body: lines.join('\n'),
    urgency: 'normal',
    refKind: 'slack-digest',
    refId: slot,
    actions: [{ id: HQ_SLACK_DIGEST_OPEN_ACTION, label: 'Open HQ' }],
    dedupeKey: `${HQ_SLACK_DIGEST_KIND}:${slot}`
  }
}
