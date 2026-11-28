// Custom build (hq-approve-source, U5): «What came in» above a held reply — the whole message it
// answers (who, where, when, text, link), so the owner reads the question beside the answer without
// opening Slack. The text follows the card's one text rule: 13.5 / 1.5, scrolls inside, never clipped.
import { ExternalLink } from 'lucide-react'
import type { OutgoingSourceMessage } from '../../../../../shared/outgoing-approval/outgoing-approval-bell'
import { formatRelativeTime } from '@/components/activity/threads/activity-thread-presentation'
import { translate } from '@/i18n/i18n'

export function OutgoingApprovalSource({
  source
}: {
  source: OutgoingSourceMessage | null | undefined
}): React.JSX.Element | null {
  if (!source || !source.text.trim()) {
    return null
  }
  const who = [source.author, source.where].filter(Boolean).join(' · ')
  return (
    <section
      className="flex flex-col gap-1 rounded-md border border-border/60 px-2 py-1.5"
      aria-label={translate('auto.outgoingApproval.source', 'What came in')}
      data-approval-source="true"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {translate('auto.outgoingApproval.source', 'What came in')}
        </span>
        <span className="min-w-0 flex-1 truncate" title={who}>
          {who}
        </span>
        <span className="shrink-0">{formatRelativeTime(source.at)}</span>
        {source.link ? (
          <button
            type="button"
            className="shrink-0 hover:text-foreground"
            title={translate('auto.outgoingApproval.sourceOpen', 'Open the message')}
            aria-label={translate('auto.outgoingApproval.sourceOpen', 'Open the message')}
            onClick={() => void window.api.shell.openUrl(source.link ?? '')}
          >
            <ExternalLink className="size-3" aria-hidden />
          </button>
        ) : null}
      </div>
      <p className="scrollbar-sleek max-h-[40vh] overflow-auto font-sans text-[13.5px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">
        {source.text}
      </p>
    </section>
  )
}
