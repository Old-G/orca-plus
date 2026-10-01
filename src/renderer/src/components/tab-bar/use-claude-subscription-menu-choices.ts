import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { translate } from '@/i18n/i18n'
import { listClaudeSubscriptionChoices } from '@/lib/claude-subscription-choice'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { parseWslUncPath } from '../../../../shared/wsl-paths'

/** Custom build (claude-subscriptions): the Claude subscriptions a "+" menu launch can pick;
 *  null without a worktree, off this machine, or with none configured. */
export function useClaudeSubscriptionMenuChoices(
  worktreeId: string | undefined
): ReturnType<typeof listClaudeSubscriptionChoices> {
  const agentDetectionTarget = useAgentDetectionTargetForWorktree(worktreeId ?? null)
  const claudeSubscriptions = useAppStore((s) => s.settings?.claudeSubscriptions)
  const defaultClaudeSubscriptionId = useAppStore((s) => s.settings?.defaultClaudeSubscriptionId)
  // Subscription dirs exist on this machine only: an SSH, paired-host or WSL launch runs elsewhere.
  const isHostLocalWorktree = useAppStore((s) => {
    const path = worktreeId
      ? findWorktreeById(selectWorktreesByRepo(s), worktreeId)?.path
      : undefined
    return path !== undefined && parseWslUncPath(path) === null
  })
  return useMemo(
    () =>
      agentDetectionTarget?.kind !== 'local' || !isHostLocalWorktree
        ? null
        : listClaudeSubscriptionChoices(
            { claudeSubscriptions, defaultClaudeSubscriptionId },
            translate('auto.claudeSubscriptions.baseLabel', 'Main sign-in')
          ),
    [
      agentDetectionTarget?.kind,
      claudeSubscriptions,
      defaultClaudeSubscriptionId,
      isHostLocalWorktree
    ]
  )
}
