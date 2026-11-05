// Custom build (hq-plus-brain): the words on a «Brain» row — where it came from, its state, the day.
import type {
  HqBrainGroup,
  HqBrainHeadKind,
  HqBrainRow,
  HqBrainStatus
} from '../../../../../shared/hq-brain'

export const HQ_BRAIN_CHIP_LABEL: Record<HqBrainGroup | 'all', string> = {
  all: 'All',
  chat: 'Chats',
  sent: 'Slack & Approve',
  wait: 'Waiting',
  clickup: 'ClickUp',
  code: 'Code & MR',
  other: 'Other'
}

export const HQ_BRAIN_HEAD_LABEL: Record<HqBrainHeadKind, string> = {
  task: 'ClickUp task',
  mr: 'Merge request',
  project: 'Project',
  person: 'Person',
  words: 'Search'
}

const SOURCE_LABEL: Record<string, string> = {
  claude: 'Chat',
  codex: 'Codex chat',
  'orca-chat': 'Chat',
  'pulse:orca': 'Agent session',
  'pulse:journal': 'Session summary',
  'pulse:threads': 'Slack',
  'pulse:slack': 'Slack',
  'pulse:waitings': 'Waiting',
  clickup: 'ClickUp · task',
  'pulse:clickup': 'ClickUp · comment',
  gitlab: 'GitLab · MR',
  'pulse:git': 'Git',
  docs: 'Doc',
  wiki: 'Wiki',
  hq: 'HQ'
}

/** The source line before the state: «Chat · acme · atom fact», «Slack · DM with Ann», «Waiting · Ann». */
export function hqBrainSourceLabel(row: HqBrainRow): string {
  if (row.source === 'pulse:decisions') {
    // «Slack · send message — DEV-1 — approved» → «Slack», and where it went.
    const head = (row.title ?? '').split(' — ')[0]
    if (row.status?.kind !== 'sent') {
      return ['Decision', row.project].filter(Boolean).join(' · ')
    }
    const [service, operation] = head.split(' · ')
    return [service || 'Approve', row.target ?? operation ?? null].filter(Boolean).join(' · ')
  }
  if (row.source === 'pulse:waitings') {
    return ['Waiting', row.person].filter(Boolean).join(' · ')
  }
  const label = SOURCE_LABEL[row.source] ?? row.source
  const atom = row.atom ? `atom ${row.atom}` : null
  return [label, row.project, atom].filter(Boolean).join(' · ')
}

/** The small state tag: sent, rejected, open, closed, cancelled. */
export function hqBrainStatusTag(
  status: HqBrainStatus | null
): { text: string; tone: 'ok' | 'no' | 'wait' } | null {
  if (!status) {
    return null
  }
  if (status.kind === 'sent') {
    switch (status.outcome) {
      case 'approved':
        return { text: 'sent', tone: 'ok' }
      case 'edited':
        return { text: 'edited · sent', tone: 'ok' }
      case 'rejected':
        return { text: 'rejected', tone: 'no' }
      default:
        return null
    }
  }
  switch (status.status) {
    case 'open':
      return { text: 'open', tone: 'wait' }
    case 'resolved':
      return { text: 'closed', tone: 'ok' }
    case 'cancelled':
      return { text: 'cancelled', tone: 'no' }
  }
}

/** A title worth a line of its own: a task's, an MR's, a page's — not a chat's first message. */
export function hqBrainRowTitle(row: HqBrainRow): string | null {
  if (
    !row.title ||
    row.group === 'chat' ||
    row.group === 'wait' ||
    row.source === 'pulse:decisions'
  ) {
    return null
  }
  const title = row.title.trim()
  return row.text.includes(title.slice(0, 40)) ? null : title
}

const pad = (value: number): string => String(value).padStart(2, '0')

function localDay(at: number): string {
  const day = new Date(at)
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/** «Today», «Yesterday», «29 October», with the year when it is not this one. */
export function hqBrainDayLabel(day: string, now: number): string {
  if (day === localDay(now)) {
    return 'Today'
  }
  if (day === localDay(now - 24 * 60 * 60_000)) {
    return 'Yesterday'
  }
  const date = new Date(`${day}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return day
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

export function hqBrainClock(at: number): string {
  const time = new Date(at)
  return `${pad(time.getHours())}:${pad(time.getMinutes())}`
}
