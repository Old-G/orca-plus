// Custom build (hq): the filter row over a project card's ClickUp tasks — mine or everyone's, and
// status chips with how many tasks each holds.
import type { ClickUpTaskScope } from '../../../../../shared/clickup-types'
import { translate } from '@/i18n/i18n'
import type { HqStatusOption } from './hq-project-task-filter'

const CHIP_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent aria-pressed:border-foreground/40 aria-pressed:bg-accent aria-pressed:text-foreground'

export function HqProjectTaskFilters({
  scope,
  onScope,
  options,
  statuses,
  onToggleStatus
}: {
  scope: ClickUpTaskScope
  onScope: (scope: ClickUpTaskScope) => void
  options: readonly HqStatusOption[]
  statuses: readonly string[]
  onToggleStatus: (name: string) => void
}): React.JSX.Element {
  const chosen = new Set(statuses.map((name) => name.trim().toLocaleLowerCase()))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={scope === 'mine'}
        onClick={() => onScope('mine')}
        className={CHIP_CLASS}
      >
        {translate('auto.hq.project.mine', 'Mine')}
      </button>
      <button
        type="button"
        aria-pressed={scope === 'all'}
        onClick={() => onScope('all')}
        className={CHIP_CLASS}
      >
        {translate('auto.hq.project.everyone', 'Everyone')}
      </button>
      {options.length > 0 ? <span className="mx-1 h-4 w-px bg-border" aria-hidden /> : null}
      {options.map((option) => (
        <button
          key={option.status.name}
          type="button"
          aria-pressed={chosen.has(option.status.name.trim().toLocaleLowerCase())}
          onClick={() => onToggleStatus(option.status.name)}
          className={CHIP_CLASS}
        >
          {/* Why: the dot carries the workspace's own status color; the label stays tokenized. */}
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-muted-foreground"
            style={option.status.color ? { backgroundColor: option.status.color } : undefined}
          />
          {option.status.name}
          <span className="tabular-nums">{option.count}</span>
        </button>
      ))}
    </div>
  )
}
