// Custom build (hq): what the HQ «Today» tab's buttons do — nudge an agent, and start a Claude
// session in the HQ folder's workspace for a command or a reminder.
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { translate } from '@/i18n/i18n'
import { activeAgentNotesSendFailureMessage } from '@/lib/active-agent-note-send-result'
import { sendMessageToAgent } from '@/lib/agent-message-send'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import {
  deriveRunningAgentSendTargets,
  runningAgentMessageTarget
} from '@/lib/running-agent-targets'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'

export type HqActionResult = { ok: true } | { ok: false; message: string }

function samePath(a: string, b: string): boolean {
  const normalize = (path: string): string => path.trim().replace(/[\\/]+$/, '')
  return normalize(a) === normalize(b)
}

/** The workspace commands run in: the HQ folder's own checkout, when HQ is added as a project. */
export function findHqWorktreeId(
  hqPath: string | null | undefined,
  repos: readonly Pick<Repo, 'id' | 'path'>[],
  worktreesByRepo: Readonly<
    Record<string, readonly Pick<Worktree, 'id' | 'isArchived' | 'isMainWorktree'>[] | undefined>
  >
): string | null {
  if (!hqPath?.trim()) {
    return null
  }
  const repo = repos.find((candidate) => samePath(candidate.path, hqPath))
  const worktrees = (repo ? (worktreesByRepo[repo.id] ?? []) : []).filter(
    (worktree) => !worktree.isArchived
  )
  return (worktrees.find((worktree) => worktree.isMainWorktree) ?? worktrees[0])?.id ?? null
}

/** Sends the agent a message the way the notes menu does: its pane, or its chat's outbox. */
export async function sendHqAgentMessage(
  card: Pick<DashboardCard, 'paneKey' | 'worktreeId'>,
  text: string
): Promise<HqActionResult> {
  const target = deriveRunningAgentSendTargets(useAppStore.getState(), card.worktreeId).find(
    (candidate) => candidate.paneKey === card.paneKey
  )
  if (!target) {
    return {
      ok: false,
      message: translate('auto.hq.today.agentGone', 'This agent is no longer open.')
    }
  }
  if (target.status === 'disabled') {
    return {
      ok: false,
      message:
        target.disabledReason ??
        translate('auto.hq.today.agentBusy', 'This agent cannot take a message right now.')
    }
  }
  const result = await sendMessageToAgent({
    worktreeId: card.worktreeId,
    target: runningAgentMessageTarget(target),
    prompt: text
  })
  return result.status === 'sent'
    ? { ok: true }
    : {
        ok: false,
        message: activeAgentNotesSendFailureMessage(result.status, {
          explicitTarget: true,
          code: result.code
        })
      }
}

/** Opens the HQ workspace and starts Claude there with the prompt submitted once it is ready. */
export function launchHqCommand(worktreeId: string, prompt: string): HqActionResult {
  const state = useAppStore.getState()
  const executionHostId = getExecutionHostIdForWorktree(state, worktreeId)
  if (!state.getKnownWorktreeById(worktreeId, executionHostId)) {
    return {
      ok: false,
      message: translate('auto.hq.today.noHqWorkspace', 'The HQ workspace is not open in Orca.')
    }
  }
  state.setActiveWorktree(worktreeId, executionHostId)
  const launched = launchAgentInNewTab({
    agent: 'claude',
    worktreeId,
    prompt: prompt.trim(),
    promptDelivery: 'submit-after-ready',
    launchSource: 'unknown'
  })
  return launched
    ? { ok: true }
    : {
        ok: false,
        message: translate('auto.hq.today.launchFailed', "Couldn't start Claude in HQ.")
      }
}
