// Custom build (slack-notifications): posts an admitted agent notification into the workspace's
// Slack thread. It only reads what the notification pipeline already decided; it never derives
// agent status itself (docs/reference/agent-status-store.md).
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'
import { formatNotificationAgentLabel } from '../ipc/notification-options'
import {
  buildSlackAgentUpdate,
  buildSlackThreadParent,
  slackUpdateKind,
  workspaceTitle,
  type SlackGitSummary,
  type SlackLinkedItem
} from './slack-agent-message'
import { slackTargetChannelId, type SlackSession } from './slack-client'
import { SlackApiError } from './slack-request'
import type { SlackThreadStore } from './slack-thread-store'

export type SlackAgentNotifierDeps = {
  /** Cheap check (no decryption) so an unconnected profile does no work at all. */
  isConnected: () => boolean
  withSession: <T>(run: (session: SlackSession) => Promise<T>) => Promise<T>
  request: (
    token: string,
    method: string,
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
  threads: SlackThreadStore
  readLinkedItem: (worktreeId: string) => SlackLinkedItem | null
  /** Null when the execution host cannot answer; a missing summary is never guessed. */
  readGitSummary: (worktreeId: string) => Promise<SlackGitSummary | null>
}

export type SlackAgentNotifier = {
  notify: (request: NotificationDispatchRequest) => Promise<void>
}

// Why: Slack answers these when the thread's parent was deleted, so a fresh parent is posted.
const LOST_THREAD_ERRORS = new Set(['thread_not_found', 'message_not_found'])
const RECENT_NOTIFICATION_IDS_LIMIT = 200

export function createSlackAgentNotifier(deps: SlackAgentNotifierDeps): SlackAgentNotifier {
  // Why: two updates for one workspace racing would each create a parent thread.
  const chains = new Map<string, Promise<void>>()
  const recentIds = new Set<string>()

  const ensureThread = async (
    session: SlackSession,
    channel: string,
    worktreeId: string,
    title: string
  ): Promise<string> => {
    const existing = deps.threads.get(channel, worktreeId)
    if (existing) {
      return existing
    }
    const parent = buildSlackThreadParent({ title, linked: deps.readLinkedItem(worktreeId) })
    const posted = await deps.request(session.tokens.botToken, 'chat.postMessage', {
      channel,
      text: parent.text,
      blocks: parent.blocks,
      unfurl_links: false
    })
    const ts = typeof posted.ts === 'string' ? posted.ts : null
    if (!ts) {
      throw new SlackApiError('no_thread_ts', 'Slack did not return the thread timestamp.')
    }
    deps.threads.set(channel, worktreeId, ts)
    return ts
  }

  const deliver = async (
    request: NotificationDispatchRequest,
    worktreeId: string
  ): Promise<void> => {
    const kind = slackUpdateKind(request)
    if (!kind) {
      return
    }
    const title = workspaceTitle(request)
    const git = await deps.readGitSummary(worktreeId).catch(() => null)
    const update = buildSlackAgentUpdate({
      kind,
      agentLabel: formatNotificationAgentLabel(request.agentType),
      title,
      request,
      git
    })
    await deps.withSession(async (session) => {
      const channel = slackTargetChannelId(session.metadata)
      const post = async (threadTs: string): Promise<void> => {
        await deps.request(session.tokens.botToken, 'chat.postMessage', {
          channel,
          thread_ts: threadTs,
          text: update.text,
          blocks: update.blocks,
          unfurl_links: false
        })
      }
      try {
        await post(await ensureThread(session, channel, worktreeId, title))
      } catch (error) {
        if (!(error instanceof SlackApiError && LOST_THREAD_ERRORS.has(error.code))) {
          throw error
        }
        deps.threads.forget(channel, worktreeId)
        await post(await ensureThread(session, channel, worktreeId, title))
      }
    })
  }

  return {
    notify: (request) => {
      const worktreeId = request.worktreeId
      if (!worktreeId || !deps.isConnected()) {
        return Promise.resolve()
      }
      if (request.notificationId) {
        const key = `${request.notificationId}:${request.agentState ?? ''}`
        if (recentIds.has(key)) {
          return Promise.resolve()
        }
        recentIds.add(key)
        if (recentIds.size > RECENT_NOTIFICATION_IDS_LIMIT) {
          recentIds.delete(recentIds.values().next().value ?? key)
        }
      }
      const previous = chains.get(worktreeId) ?? Promise.resolve()
      const next = previous
        .then(() => deliver(request, worktreeId))
        .catch((error: unknown) => {
          if (error instanceof SlackApiError && error.code === 'not_connected') {
            return
          }
          console.warn(
            '[slack] agent update not delivered:',
            error instanceof Error ? error.message : error
          )
        })
      chains.set(worktreeId, next)
      void next.finally(() => {
        if (chains.get(worktreeId) === next) {
          chains.delete(worktreeId)
        }
      })
      return next
    }
  }
}
