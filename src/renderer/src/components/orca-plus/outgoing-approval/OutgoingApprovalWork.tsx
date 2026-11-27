// Custom build (router v2 T1, owner 28.11): «Work: X» on an approval card — the work (a task's chain of
// chats) an answer to this message will be routed to. Approve confirms it; a pick here rebinds it, and
// the footer above shows the id it will carry.
import { Waypoints } from 'lucide-react'
import type { OutgoingWorkOptions } from '../../../../../shared/outgoing-approval/outgoing-approval-options'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function OutgoingApprovalWork({
  work,
  selected,
  busy,
  onSelect
}: {
  work: OutgoingWorkOptions | null | undefined
  selected: string | null
  busy: boolean
  onSelect: (id: string | null) => void
}): React.JSX.Element | null {
  if (!work || work.choices.length === 0) {
    return null
  }
  const active = selected ?? work.current
  return (
    <div
      className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      aria-label={translate(
        'auto.outgoingApproval.workChoices',
        'The work an answer to this message goes to'
      )}
    >
      <Waypoints className="size-3 shrink-0" aria-hidden />
      <span>{translate('auto.outgoingApproval.work', 'Work:')}</span>
      {work.choices.map((choice) => (
        <Button
          key={choice.id}
          type="button"
          size="xs"
          disabled={busy}
          variant={active === choice.id ? 'secondary' : 'ghost'}
          aria-pressed={active === choice.id}
          title={choice.why}
          onClick={() => onSelect(choice.id === work.current ? null : choice.id)}
        >
          <span className="max-w-48 truncate">{choice.title}</span>
          {choice.id === work.current && work.suggested ? (
            <span className="text-[10px] opacity-70">
              {translate('auto.outgoingApproval.workSuggested', 'suggested')}
            </span>
          ) : null}
        </Button>
      ))}
    </div>
  )
}
