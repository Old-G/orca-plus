// Custom build (hq-chats): a pinned item's page on the right of HQ's messenger view — the same
// content the earlier tab showed, laid out by the pane's own width.
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { HqPinnedId } from './hq-messenger-selection'
import { HqAgentsTab } from './HqAgentsTab'
import { HqDoneJournalTab } from './HqDoneJournalTab'
import { HqMapTab } from './HqMapTab'
import { hqPinnedLabel } from './HqPinnedList'
import { HqProjectsTab } from './HqProjectsTab'
import { HqTodayInbox } from './HqTodayInbox'
import { HqNotesTab } from './HqNotesTab'
import { HqWikiTab } from './HqWikiTab'

function PinnedContent({ id }: { id: HqPinnedId }): React.JSX.Element {
  switch (id) {
    case 'today':
      return <HqTodayInbox />
    case 'waiting':
      return <HqNotesTab />
    case 'journal':
      return <HqDoneJournalTab />
    case 'projects':
      return <HqProjectsTab />
    case 'wiki':
      return <HqWikiTab />
    case 'map':
      return <HqMapTab />
    case 'agents':
      return <HqAgentsTab />
  }
}

export function HqPinnedPane({
  id,
  onBack
}: {
  id: HqPinnedId
  /** Back to the list where the screen is too narrow to show both. */
  onBack: () => void
}): React.JSX.Element {
  const title = hqPinnedLabel(id)
  return (
    // Why: its own `hq` container, so the tab pages lay out by this pane's width, not the screen's.
    <section aria-label={title} className="@container/hq flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2.5">
        <span className="@min-3xl/hq:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={translate('auto.hq.chats.back', 'Back to chats')}
          >
            <ArrowLeft />
          </Button>
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div key={id} className="min-h-0 flex-1">
        <PinnedContent id={id} />
      </div>
    </section>
  )
}
