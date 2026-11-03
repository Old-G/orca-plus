// Custom build (hq-intake-decide, owner 03.11: «the card looks as usual; when something is wrong I press
// it, a window like To work opens and I change the project, the session and the rest»): what HQ proposed
// for this request, its kind to keep or change, and — once anything differs — a line on why, which the
// guess → final log keeps and the next guess in that place reads.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { HqPlusTakeHint } from './hq-plus-take-hint'

const KINDS = [
  { value: 'do', label: () => translate('auto.hqPlus.take.kindDo', 'Do') },
  { value: 'answer', label: () => translate('auto.hqPlus.take.kindAnswer', 'Answer') },
  { value: 'reply', label: () => translate('auto.hqPlus.take.kindReply', 'Reply to our question') },
  { value: 'fyi', label: () => translate('auto.hqPlus.take.kindFyi', 'FYI') }
] as const

export function HqPlusTakeGuess({
  guess,
  kind,
  onKindChange,
  changed,
  why,
  onWhyChange,
  disabled
}: {
  guess: NonNullable<HqPlusTakeHint['guess']>
  kind: string
  onKindChange: (kind: string) => void
  /** The owner changed the project, the chat or the kind HQ proposed. */
  changed: boolean
  why: string
  onWhyChange: (why: string) => void
  disabled: boolean
}): React.JSX.Element {
  const label = (value: string | null): string =>
    KINDS.find((entry) => entry.value === value)?.label() ?? value ?? '—'
  const sure = guess.confidence === null ? null : Math.round(guess.confidence * 100)
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">
        {translate('auto.hqPlus.take.suggested', 'HQ suggested: {{kind}}{{sure}}', {
          kind: label(guess.kind),
          sure: sure === null ? '' : ` · ${sure}%`
        })}
        {guess.why ? ` — ${guess.why}` : ''}
      </p>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-14 shrink-0">{translate('auto.hqPlus.take.kind', 'Kind')}</span>
        <Select value={kind} onValueChange={onKindChange} disabled={disabled}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {KINDS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {changed ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-14 shrink-0">{translate('auto.hqPlus.take.why', 'Why')}</span>
          <input
            id="hqp-take-why"
            className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground"
            value={why}
            maxLength={500}
            disabled={disabled}
            placeholder={translate(
              'auto.hqPlus.take.whyHint',
              'Why HQ was wrong (optional) — it learns from this'
            )}
            onChange={(event) => onWhyChange(event.target.value)}
          />
        </label>
      ) : null}
    </div>
  )
}
