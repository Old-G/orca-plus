// Custom build (hq-plus-round6): what HQ+ and the evening check keep on a waiting — its linked task,
// a snooze, the last reminder and the last check — as tagged lines at the end of its detail, so no
// schema change is needed and an older Orca+ just shows them as text.
const TAGS = {
  task: 'Task',
  snoozedUntil: 'Snoozed until',
  nudged: 'Nudged',
  checked: 'Checked'
} as const

export type HqWaitingTag = keyof typeof TAGS
const TAG_KEYS = ['task', 'snoozedUntil', 'nudged', 'checked'] as const

export type HqWaitingTags = {
  /** The detail without the tag lines. */
  text: string | null
  task: string | null
  /** Start of the day the snooze ends (local), ms; null when not snoozed. */
  snoozedUntil: number | null
  /** Last reminder day, YYYY-MM-DD. */
  nudged: string | null
  /** «YYYY-MM-DD HH:MM — what the check saw». */
  checked: string | null
}

const LINE = new RegExp(`^(${Object.values(TAGS).join('|')}): (.+)$`)

function dayStart(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : null
}

export function readHqWaitingTags(detail: string | null): HqWaitingTags {
  const tags: Record<HqWaitingTag, string | null> = {
    task: null,
    snoozedUntil: null,
    nudged: null,
    checked: null
  }
  const rest: string[] = []
  for (const line of (detail ?? '').split('\n')) {
    const match = LINE.exec(line.trim())
    const tag = match ? TAG_KEYS.find((key) => TAGS[key] === match[1]) : undefined
    if (match && tag) {
      tags[tag] = match[2].trim()
    } else {
      rest.push(line)
    }
  }
  const text = rest.join('\n').trim()
  return {
    text: text || null,
    task: tags.task,
    snoozedUntil: tags.snoozedUntil ? dayStart(tags.snoozedUntil) : null,
    nudged: tags.nudged,
    checked: tags.checked
  }
}

/** The detail with one tag set (or removed with null); the other lines stay as they were. */
export function withHqWaitingTag(
  detail: string | null,
  tag: HqWaitingTag,
  value: string | null
): string | null {
  const kept = (detail ?? '')
    .split('\n')
    .filter((line) => LINE.exec(line.trim())?.[1] !== TAGS[tag])
  const lines = value ? [...kept, `${TAGS[tag]}: ${value.replace(/\s+/g, ' ').trim()}`] : kept
  const joined = lines.join('\n').trim()
  return joined || null
}

export function hqWaitingDay(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Snooze ends: tomorrow, next Monday, or in a week — as the day it wakes up. */
export function hqWaitingSnoozeDay(choice: 'tomorrow' | 'monday' | 'week', now: number): string {
  const date = new Date(now)
  const add = choice === 'tomorrow' ? 1 : choice === 'week' ? 7 : (8 - date.getDay()) % 7 || 7
  date.setDate(date.getDate() + add)
  return hqWaitingDay(date.getTime())
}

/**
 * Where a waiting was asked, as a link: an https ref as it is, `slack:<channel>:<ts>` and
 * `clickup:<task>[:<comment>]` (what ask-person records) as their web addresses.
 */
export function hqWaitingSourceUrl(ref: string | null): string | null {
  if (!ref) {
    return null
  }
  if (/^https:\/\/\S+$/.test(ref)) {
    return ref
  }
  const [kind, first, second] = ref.split(':')
  if (kind === 'slack' && /^[A-Z0-9]+$/.test(first ?? '') && /^\d+\.\d+$/.test(second ?? '')) {
    return `https://slack.com/archives/${first}/p${second.replace('.', '')}`
  }
  if (kind === 'clickup' && /^[\w-]+$/.test(first ?? '')) {
    return `https://app.clickup.com/t/${first}`
  }
  return null
}

/** A ClickUp task id (DEV-123) or a link, as the owner typed it; null when it is neither. */
export function hqWaitingTaskRef(input: string): string | null {
  const value = input.trim()
  if (/^https:\/\/\S+$/.test(value)) {
    return value
  }
  return /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(value.toUpperCase()) ? value.toUpperCase() : null
}
