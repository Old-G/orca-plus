// Custom build (hq-waiting-replies): the coloured counters on top of HQ → Notes, after iPhone's
// Reminders — each one filters the list to itself, a second press shows everything again.
import { AlarmClock, Hourglass, Inbox, MessageSquareReply } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { HqNotesFilter } from './hq-notes-board'

const TILES: readonly { filter: HqNotesFilter; icon: typeof Hourglass; label: () => string }[] = [
  {
    filter: 'waiting',
    icon: Hourglass,
    label: () => translate('auto.hq.notes.tileWaiting', 'We wait on')
  },
  {
    filter: 'answered',
    icon: MessageSquareReply,
    label: () => translate('auto.hq.notes.tileAnswered', 'Answered')
  },
  { filter: 'on-me', icon: Inbox, label: () => translate('auto.hq.notes.tileOnMe', 'Wait on us') },
  {
    filter: 'overdue',
    icon: AlarmClock,
    label: () => translate('auto.hq.notes.tileOverdue', 'Overdue')
  }
]

export function HqNotesTiles({
  counts,
  selected,
  onSelect
}: {
  counts: Record<HqNotesFilter, number>
  selected: HqNotesFilter | null
  onSelect: (filter: HqNotesFilter | null) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {TILES.map(({ filter, icon: Icon, label }) => (
        <button
          key={filter}
          type="button"
          data-tone={filter}
          data-selected={selected === filter}
          aria-pressed={selected === filter}
          onClick={() => onSelect(selected === filter ? null : filter)}
          className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[selected=true]:ring-2 data-[selected=true]:ring-ring"
        >
          <span className="flex items-center justify-between">
            <span className="flex size-7 items-center justify-center rounded-full text-background group-data-[tone=answered]:bg-status-success group-data-[tone=on-me]:bg-callout-note group-data-[tone=overdue]:bg-destructive group-data-[tone=waiting]:bg-status-warning">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="text-2xl font-semibold text-card-foreground tabular-nums">
              {counts[filter]}
            </span>
          </span>
          <span className="text-xs font-medium text-muted-foreground">{label()}</span>
        </button>
      ))}
    </div>
  )
}
