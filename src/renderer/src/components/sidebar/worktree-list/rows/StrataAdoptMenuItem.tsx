import React from 'react'
import { Layers } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useStrataStatus } from '@/lib/strata-status-store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { isGitRepoKind } from '../../../../../../shared/repo-kind'
import type { Repo } from '../../../../../../shared/repo-types'
import { canAdoptStrata } from '../../../../../../shared/strata-status'

async function adoptStrata(repo: Repo): Promise<void> {
  const result = await window.api.strata.adopt(repo.id)
  if (!result.ok) {
    toast.error(translate('auto.strata.adopt.failed', 'Could not start Strata adoption'), {
      description: result.error
    })
    return
  }
  // Why: main created the worktree, so the sidebar learns of it only after a fetch.
  await useAppStore.getState().fetchWorktrees(repo.id)
  activateAndRevealWorktree(result.worktreeId)
}

/**
 * Custom build (strata-status): starts `/strata:adopt` in a new worktree of a project that is not
 * fully on Strata. Only ever user-started; the agent stops at its adoption report for approval.
 */
export function StrataAdoptMenuItem({ repo }: { repo: Repo }): React.JSX.Element | null {
  const status = useStrataStatus(repo.id)
  if (!isGitRepoKind(repo) || !canAdoptStrata(status)) {
    return null
  }
  return (
    <DropdownMenuItem onSelect={() => void adoptStrata(repo)}>
      <Layers className="size-3.5" />
      {translate('auto.strata.adopt.menu', 'Enable Strata')}
    </DropdownMenuItem>
  )
}
