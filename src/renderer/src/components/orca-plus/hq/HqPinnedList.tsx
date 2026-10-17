// Custom build (hq-chats): the pinned items above HQ's chat list — the earlier tabs, each one row
// with a short count where one is cheap to know.
import {
  Activity,
  BookOpen,
  FileText,
  History,
  KanbanSquare,
  LayoutGrid,
  Network,
  Sun,
  Users
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { HqPinnedId } from './hq-messenger-selection'

type Pinned = { id: HqPinnedId; icon: LucideIcon; label: () => string }

const PINNED: readonly Pinned[] = [
  { id: 'today', icon: Sun, label: () => translate('auto.hq.tab.today', 'Today') },
  { id: 'waiting', icon: Users, label: () => translate('auto.hq.pinned.notes', 'Notes') },
  {
    id: 'journal',
    icon: History,
    label: () => translate('auto.hq.pinned.doneForYou', 'Done for you')
  },
  // Custom build (hq-feed): one timeline of Slack, ClickUp, reviews and what was sent.
  { id: 'feed', icon: Activity, label: () => translate('auto.hq.pinned.feed', 'Feed') },
  // Custom build (hq-reports): the reports agents leave in HQ, with the owner's dictated decisions.
  { id: 'reports', icon: FileText, label: () => translate('auto.hq.pinned.reports', 'Reports') },
  { id: 'projects', icon: LayoutGrid, label: () => translate('auto.hq.tab.projects', 'Projects') },
  { id: 'wiki', icon: BookOpen, label: () => translate('auto.hq.tab.wiki', 'Wiki') },
  { id: 'map', icon: Network, label: () => translate('auto.hq.tab.map', 'Map') },
  {
    id: 'agents',
    icon: KanbanSquare,
    label: () => translate('auto.hq.pinned.agentBoard', 'Agent board')
  }
]

export function hqPinnedLabel(id: HqPinnedId): string {
  return PINNED.find((entry) => entry.id === id)?.label() ?? id
}

export function HqPinnedList({
  selected,
  notes,
  onSelect
}: {
  selected: HqPinnedId | null
  /** Short trailing text per item, e.g. «2 on you». */
  notes: Partial<Record<HqPinnedId, string>>
  onSelect: (id: HqPinnedId) => void
}): React.JSX.Element {
  return (
    <ul aria-label={translate('auto.hq.pinned.label', 'Pinned')} className="flex flex-col gap-px">
      {PINNED.map(({ id, icon: Icon, label }) => (
        <li key={id}>
          <button
            type="button"
            aria-current={selected === id ? 'true' : undefined}
            data-current={selected === id ? 'true' : undefined}
            onClick={() => onSelect(id)}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none data-[current=true]:bg-accent"
          >
            <span className="inline-flex w-7 shrink-0 justify-center text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{label()}</span>
            {notes[id] ? (
              <span className="max-w-36 shrink-0 truncate text-[11px] text-muted-foreground">
                {notes[id]}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
