import React from 'react'
import { Layers } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useStrataStatus } from '@/lib/strata-status-store'

/**
 * Custom build (strata-status): a muted layers glyph for a project on Strata — solid with the wiki,
 * faded with only CLAUDE.md. Nothing for the rest, so unadopted projects stay quiet.
 */
export function StrataStatusIndicator({ repoId }: { repoId: string }): React.JSX.Element | null {
  const status = useStrataStatus(repoId)
  if (status !== 'full' && status !== 'claude-md') {
    return null
  }
  const label =
    status === 'full'
      ? translate('auto.strata.status.full', 'Strata: wiki and CLAUDE.md')
      : translate('auto.strata.status.claudeMd', 'Strata: CLAUDE.md only, no wiki yet')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex shrink-0 items-center text-muted-foreground',
            status === 'claude-md' && 'opacity-50'
          )}
          aria-label={label}
        >
          <Layers className="size-3" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
