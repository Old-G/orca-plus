// Custom build (hq-today-inbox): one line of HQ → Today's list — who or where it comes from, what it
// is (a coloured chip instead of a «New:» / «Overdue:» prefix), and how long it has waited.
import type { ReactNode } from 'react'
import { hqSlackRequestKind } from '../../../../../shared/hq-slack-scout'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { cn } from '@/lib/utils'
import { hqInboxBadge, type HqInboxItem, type HqInboxSection } from './hq-today-inbox-items'
import { ColumnHeader } from './hq-waiting-parts'

type ChipTone = 'danger' | 'warning' | 'success' | 'muted'

export function hqInboxSectionTitle(section: HqInboxSection): string {
  switch (section) {
    case 'needs':
      return translate('auto.hq.inbox.needs', 'Needs you')
    case 'ready':
      return translate('auto.hq.inbox.ready', 'Ready for review')
    case 'tasks':
      return translate('auto.hq.inbox.tasks', 'Tasks')
    case 'reviews':
      return translate('auto.hq.inbox.reviews', 'Reviews')
  }
}

function itemText(item: HqInboxItem): {
  title: string
  subtitle: string
  chip: { label: string; tone: ChipTone } | null
} {
  switch (item.kind) {
    case 'slack': {
      const kind = hqSlackRequestKind(item.draft)
      const chip =
        kind === 'answer'
          ? { label: translate('auto.hq.slack.kind.answer', 'Reply'), tone: 'success' as const }
          : kind === 'fyi'
            ? { label: translate('auto.hq.slack.kind.fyi', 'FYI'), tone: 'muted' as const }
            : { label: translate('auto.hq.slack.kind.do', 'Do'), tone: 'warning' as const }
      return {
        title: item.draft.ask || item.draft.title,
        subtitle: [
          item.draft.author,
          item.draft.source === 'clickup' ? 'ClickUp' : 'Slack',
          item.draft.channelName
        ]
          .filter(Boolean)
          .join(' · '),
        chip
      }
    }
    case 'agent':
      return {
        title: item.card.conversationName || item.card.task || item.card.agentType,
        subtitle: item.card.repoName,
        chip: { label: translate('auto.hq.inbox.agentWaitsChip', 'Agent waits'), tone: 'warning' }
      }
    case 'ready':
      return {
        title: item.task.title,
        subtitle: [item.task.identifier, item.task.status.name].join(' · '),
        chip: { label: translate('auto.hq.inbox.readyChip', 'Ready'), tone: 'success' }
      }
    case 'new-task':
      return {
        title: item.task.title,
        subtitle: ['ClickUp', item.task.listName ?? item.task.identifier].join(' · '),
        chip: { label: translate('auto.hq.inbox.newTask', 'New'), tone: 'muted' }
      }
    case 'due':
      return {
        title: item.task.title,
        subtitle: ['ClickUp', item.task.status.name].join(' · '),
        chip: item.overdue
          ? { label: translate('auto.hq.inbox.overdue', 'Overdue'), tone: 'danger' }
          : { label: translate('auto.hq.inbox.dueToday', 'Due today'), tone: 'warning' }
      }
    case 'review':
      return {
        title: item.review.title,
        subtitle: [item.review.ref, item.review.author].filter(Boolean).join(' · '),
        chip: null
      }
  }
}

const ROW_CLASS =
  'flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=true]:bg-accent'

export function HqInboxRow({
  item,
  active,
  now,
  onSelect
}: {
  item: HqInboxItem
  active: boolean
  now: number
  onSelect: () => void
}): React.JSX.Element {
  const { title, subtitle, chip } = itemText(item)
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        className={ROW_CLASS}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground">
          {hqInboxBadge(item)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm">{title}</span>
          <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {chip ? (
              <span
                data-tone={chip.tone}
                className="shrink-0 rounded-full bg-muted px-1.5 py-px text-2xs font-medium text-muted-foreground data-[tone=danger]:bg-destructive/10 data-[tone=danger]:text-destructive data-[tone=success]:bg-status-success-background data-[tone=success]:text-status-success data-[tone=warning]:bg-status-warning-background data-[tone=warning]:text-status-warning"
              >
                {chip.label}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{subtitle}</span>
            {item.at ? (
              <span className="ml-auto shrink-0 tabular-nums">
                {formatShortTimeAgo(item.at, now)}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  )
}

export function HqInboxOtherRow({
  icon,
  label,
  active,
  onSelect
}: {
  icon: ReactNode
  label: string
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        className={cn(ROW_CLASS, 'items-center text-sm text-muted-foreground')}
      >
        <span className="flex size-7 shrink-0 items-center justify-center">{icon}</span>
        {label}
      </button>
    </li>
  )
}

/** A titled, framed group of rows; rows split by hairlines. */
export function HqInboxCard({
  title,
  count,
  children
}: {
  title: string
  count?: number
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={count} />
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </ul>
    </section>
  )
}
