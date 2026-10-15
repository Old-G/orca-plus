// Custom build (hq-triage): starts the taken task's Claude in a fresh worktree of one project — shared
// by «Take» on a ClickUp task and «Do» on a Slack request.
import type { PersistedNativeChatSessionOptions } from '../../../../../shared/native-chat-session-options'
import { launchWorkItemDirect } from '@/lib/launch-work-item-direct'
import type { LaunchableWorkItem } from '@/lib/launch-work-item-direct-types'
import { useAppStore } from '@/store'
import type { HqTakenSession } from './hq-triage-decisions'

export async function launchHqTakeInRepo(args: {
  item: LaunchableWorkItem
  repoId: string
  sessionOptions: PersistedNativeChatSessionOptions
  openModalFallback: () => void
}): Promise<{ launched: boolean; session: HqTakenSession | null }> {
  const existing = new Set(
    (useAppStore.getState().worktreesByRepo[args.repoId] ?? []).map((worktree) => worktree.id)
  )
  const launched = await launchWorkItemDirect({
    item: args.item,
    repoId: args.repoId,
    agentOverride: 'claude',
    promptDelivery: 'submit-after-ready',
    launchSource: 'task_page',
    telemetrySource: 'sidebar',
    nativeChatSessionOptions: args.sessionOptions,
    openModalFallback: args.openModalFallback
  })
  // Why: the launch reveals its new worktree; an older one active means it was not caught.
  const worktreeId = useAppStore.getState().activeWorktreeId
  return {
    launched,
    session:
      launched && worktreeId && !existing.has(worktreeId)
        ? { worktreeId, before: new Set(), coordinator: false }
        : null
  }
}
