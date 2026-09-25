// Custom build (slack-notifications): binds the Slack notifier to this host's store and runtime.
import type { WorkspaceLinkedItem } from '../../shared/worktree/types'
import type { GitStatusResult } from '../../shared/git-status-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { SlackGitSummary, SlackLinkedItem } from './slack-agent-message'
import { createSlackAgentNotifier, type SlackAgentNotifier } from './slack-agent-notifier'
import { withSlackSession } from './slack-client'
import { hasStoredSlackCredential } from './slack-credential-store'
import { slackRequest } from './slack-request'
import { createSlackThreadStore } from './slack-thread-store'

const GIT_SUMMARY_TIMEOUT_MS = 5_000

type WorktreeMetaReader = {
  getWorktreeMeta: (
    worktreeId: string
  ) => { linkedWorkItem?: WorkspaceLinkedItem | null } | undefined
}

export function linkedItemForSlack(
  item: WorkspaceLinkedItem | null | undefined
): SlackLinkedItem | null {
  if (!item) {
    return null
  }
  const id =
    item.clickupIdentifier ??
    item.linearIdentifier ??
    item.jiraIdentifier ??
    (item.provider === 'gitlab' && item.type === 'mr' ? `!${item.number}` : `#${item.number}`)
  return { label: `${id} ${item.title}`, url: item.url }
}

export function gitSummaryFromStatus(status: GitStatusResult): SlackGitSummary {
  let added = 0
  let removed = 0
  const paths = new Set<string>()
  for (const entry of status.entries) {
    paths.add(entry.path)
    added += entry.added ?? 0
    removed += entry.removed ?? 0
  }
  return {
    branch: status.branch?.replace(/^refs\/heads\//, '') ?? null,
    files: paths.size,
    added,
    removed,
    ahead: status.upstreamStatus?.hasUpstream ? status.upstreamStatus.ahead : null
  }
}

export function createSlackNotificationChannel(
  store: WorktreeMetaReader,
  runtime: Pick<OrcaRuntimeService, 'getRuntimeGitStatus'> | undefined
): SlackAgentNotifier {
  return createSlackAgentNotifier({
    isConnected: () => {
      try {
        return hasStoredSlackCredential()
      } catch {
        return false
      }
    },
    withSession: withSlackSession,
    request: slackRequest,
    threads: createSlackThreadStore(),
    readLinkedItem: (worktreeId) =>
      linkedItemForSlack(store.getWorktreeMeta(worktreeId)?.linkedWorkItem),
    readGitSummary: async (worktreeId) => {
      if (!runtime) {
        return null
      }
      // Why: status runs on the host that owns the worktree (SSH included); an unreachable host
      // throws or times out, and the summary is then left out rather than guessed.
      const status = await runtime.getRuntimeGitStatus(`id:${worktreeId}`, {
        includeLineStats: true,
        admissionTier: 'background',
        signal: AbortSignal.timeout(GIT_SUMMARY_TIMEOUT_MS)
      })
      return gitSummaryFromStatus(status)
    }
  })
}
