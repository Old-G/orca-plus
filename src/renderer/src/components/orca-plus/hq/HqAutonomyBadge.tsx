// Custom build (hq-autonomy): a project's autonomy level — how far an agent goes there on its own.
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import { HQ_AUTONOMY_LEVELS } from '../../../../../shared/hq-autonomy'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function hqAutonomyLabel(level: HqAutonomyLevel): string {
  switch (level) {
    case 0:
      return translate('auto.hq.autonomy.level0', 'proposes only')
    case 1:
      return translate('auto.hq.autonomy.level1', 'works in a worktree')
    case 2:
      return translate('auto.hq.autonomy.level2', 'opens a PR')
    case 3:
      return translate('auto.hq.autonomy.level3', 'merges')
  }
}

export function hqAutonomyShort(level: HqAutonomyLevel): string {
  return translate('auto.hq.autonomy.short', 'Autonomy {{value0}}', { value0: String(level) })
}

export function HqAutonomyBadge({ level }: { level: HqAutonomyLevel }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="shrink-0">
          {hqAutonomyShort(level)} · {hqAutonomyLabel(level)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        <ul className="flex flex-col gap-0.5">
          {HQ_AUTONOMY_LEVELS.map((entry) => (
            <li
              key={entry}
              data-current={entry === level}
              className="data-[current=true]:font-semibold"
            >
              {entry} — {hqAutonomyLabel(entry)}
            </li>
          ))}
        </ul>
        <p className="mt-1">
          {translate(
            'auto.hq.autonomy.hint',
            'Set in autonomy.yaml in the HQ folder. Production always waits for your yes.'
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
