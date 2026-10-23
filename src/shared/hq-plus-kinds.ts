// Custom build (hq-plus-ui-v2): what each row of HQ+'s feed is at a glance — the owner's move, a chat,
// a report, something that came in from Slack / ClickUp / mail, or background news — and the badges
// that say so. The same badge marks the row in the left column and its card in the feed.
import { HQ_JOURNAL_KIND } from './hq-journal'
import { PULSE_BELL_KIND } from './pulse-bell'
import { HQ_SLACK_REQUEST_BELL_KIND, readHqSlackRequestRef } from './hq-slack-request-bell'
import { HQ_INTAKE_KIND } from './hq-slack-intake'
import { HQ_REMIND_KIND } from './hq-remind'
import { HQ_DEFERRED_KIND } from './hq-morning-briefing'
import type { HqPlusLogItem } from './hq-plus-log'

export type HqPlusLookKind = 'me' | 'move' | 'chat' | 'report' | 'inbox' | 'bg'

export type HqPlusBadgeTone =
  | 'move'
  | 'approve'
  | 'chat'
  | 'report'
  | 'slack'
  | 'clickup'
  | 'gmail'
  | 'bg'
  | 'working'
  | 'waits'
  | 'done'

export type HqPlusBadge = { label: string; tone: HqPlusBadgeTone }

export type HqPlusSource = 'slack' | 'clickup' | 'gmail'

export type HqPlusLook = {
  kind: HqPlusLookKind
  badges: HqPlusBadge[]
  source: HqPlusSource | null
  /** For the owner's information only: kept out of «Waiting on you», cleared in one go. */
  fyi: boolean
}

const SOURCE_BADGE: Record<HqPlusSource, HqPlusBadge> = {
  slack: { label: 'SLACK', tone: 'slack' },
  clickup: { label: 'CLICKUP', tone: 'clickup' },
  gmail: { label: 'GMAIL', tone: 'gmail' }
}

const BG_TAG: Readonly<Record<string, string>> = {
  [HQ_JOURNAL_KIND.reviewFinding]: 'CODEX',
  [HQ_JOURNAL_KIND.waitingOpen]: 'NOTES',
  [HQ_JOURNAL_KIND.waitingDone]: 'NOTES',
  [HQ_JOURNAL_KIND.personReply]: 'REPLY',
  [HQ_JOURNAL_KIND.approveRequest]: 'APPROVE',
  [HQ_JOURNAL_KIND.chatMessage]: 'CHAT',
  [HQ_JOURNAL_KIND.sessionHandoff]: 'SESSIONS',
  [HQ_REMIND_KIND]: 'NOTES',
  [HQ_DEFERRED_KIND]: 'LIMIT',
  [PULSE_BELL_KIND.claudeChatLimit]: 'LIMIT',
  [PULSE_BELL_KIND.claudeAuthStop]: 'CLAUDE'
}

const MOVE: HqPlusBadge = { label: 'YOUR MOVE', tone: 'move' }

function bgTag(kind: string | null | undefined): HqPlusBadge {
  const known = kind ? BG_TAG[kind] : undefined
  if (known) {
    return { label: known, tone: 'bg' }
  }
  const family = kind?.split('.')[0]
  return { label: family === 'session' ? 'SESSIONS' : 'HQ', tone: 'bg' }
}

/** A request's source by its id: ClickUp changes and tasks, mail, else a Slack message. */
export function hqPlusRequestSource(id: string): HqPlusSource {
  if (id.startsWith('clickup')) {
    return 'clickup'
  }
  return /^(?:mail|gmail)[:-]/.test(id) ? 'gmail' : 'slack'
}

export function hqPlusLook(item: HqPlusLogItem): HqPlusLook {
  const look = (
    kind: HqPlusLookKind,
    badges: HqPlusBadge[],
    source: HqPlusSource | null = null,
    fyi = false
  ): HqPlusLook => ({ kind, badges, source, fyi })
  if (item.kind === 'me') {
    return look('me', [])
  }
  if (item.kind === 'line') {
    return item.tone === 'agent'
      ? look('chat', [{ label: 'CHAT', tone: 'chat' }])
      : look('bg', [bgTag(item.journalKind)])
  }
  const moveIfOpen = (badges: HqPlusBadge[]): HqPlusBadge[] =>
    item.open ? [MOVE, ...badges] : badges
  switch (item.type) {
    case 'approve':
      return look('move', moveIfOpen([{ label: 'APPROVE', tone: 'approve' }]))
    case 'report':
      return look('report', [{ label: 'REPORT', tone: 'report' }])
    case 'reply':
      return look('move', moveIfOpen([{ label: 'REPLY', tone: 'report' }]))
    case 'move':
      return look('move', item.open ? [MOVE] : [{ label: 'CHAT', tone: 'chat' }])
    case 'wait':
      return look('move', item.open ? [MOVE] : [{ label: 'NOTES', tone: 'bg' }])
    case 'bell':
      break
  }
  const bellKind = item.inbox?.kind ?? null
  if (bellKind === HQ_SLACK_REQUEST_BELL_KIND) {
    const ref = readHqSlackRequestRef(item.inbox?.refId ?? null)
    const source = ref ? hqPlusRequestSource(ref.id) : 'slack'
    const fyi = ref?.kind === 'fyi'
    return look(fyi ? 'bg' : 'inbox', [SOURCE_BADGE[source]], source, fyi)
  }
  if (bellKind === HQ_INTAKE_KIND) {
    return look('inbox', [SOURCE_BADGE.slack], 'slack')
  }
  if (bellKind === PULSE_BELL_KIND.handoff) {
    return look('move', moveIfOpen([{ label: 'HANDOFF', tone: 'chat' }]))
  }
  return look('bg', [bgTag(bellKind)])
}

/** «Waiting on you» holds only what needs the owner's click; FYI and reminders live elsewhere. */
export function hqPlusNeedsOwner(item: HqPlusLogItem): boolean {
  if (item.kind !== 'card' || !item.open) {
    return false
  }
  const look = hqPlusLook(item)
  return !look.fyi && look.kind !== 'bg'
}

export function hqPlusIsFyi(item: HqPlusLogItem): boolean {
  return item.kind === 'card' && item.open && hqPlusLook(item).fyi
}
