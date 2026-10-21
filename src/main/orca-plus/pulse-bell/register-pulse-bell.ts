// Custom build (pulse-bell): the bell's IPC, its live refresh, and the producers main owns
// (handoff offers, agents waiting on the user). The bell is the pulse database's first reader
// that everyone sees, so from here on it creates the file.
import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { RateLimitService } from '../../rate-limits/service'
import { agentHookServer } from '../../agent-hooks/server'
import { describeWorktree, onClaudeHandoffOffersChanged } from '../../ipc/claude-handoff'
import type { ClaudeHandoffOffer } from '../../../shared/claude-handoff-file'
import {
  PULSE_BELL_KIND,
  RENDERER_SYNCED_PULSE_BELL_KINDS,
  handoffBellItem,
  waitingAgentBellItem,
  type PulseBellInput
} from '../../../shared/pulse-bell'
import type { PulseInboxItem } from '../../../shared/pulse-types'
import { onPulseChanged } from '../pulse/pulse-change-events'
import { startHqClickUpWaitingReplies } from '../../hq-today/hq-clickup-waiting-replies'
import { startHqScoutContext } from '../../hq-today/hq-scout-context'
import { startHqPeopleSync } from '../../hq-today/hq-people'
import { startHqSlackDigest } from '../../hq-today/hq-slack-digest'
import { bindAgentFinishedInbox, clearAgentFinished } from './pulse-bell-agent-finished'
import { createWaitingAgentsTracker } from './pulse-bell-waiting-agents'
import { readPulseBellInputs } from './pulse-bell-input-validation'
import { startHqSlackRequestBell } from '../../hq-today/hq-slack-request-bell'
import {
  notifyHqSlackScoutChanged,
  onHqSlackScoutChanged,
  readHqSlackScout
} from '../../hq-today/hq-slack-scout'
import {
  collectHqClickUpRequests,
  startHqClickUpRequests
} from '../../hq-today/hq-clickup-requests'
import {
  getClickUpTask,
  getClickUpViewer,
  listClickUpCommentReplies,
  listClickUpTaskComments,
  listClickUpTasks
} from '../../clickup/clickup-tasks'
import { listHqProjectPages } from '../../hq-project-pages/hq-project-pages'
import { registerHqWaitingReplies } from '../../hq-today/register-hq-waiting-replies'
import { startHqScoutPromises } from '../../hq-today/hq-scout-promises'
import { startHqFeed } from '../../hq-today/hq-feed-collector'
import { HQ_FEED_COMMIT_LOG_ARGS, readHqFeedCommits } from '../../hq-today/hq-feed-work'
import { startHqFeedPosts } from '../../hq-today/hq-feed-posts'
import { startHqReportBell } from '../../hq-today/hq-reports'
import { generateHqText } from '../../hq-today/hq-task-questions'
import { gitExecFileAsync } from '../../git/runner'
import { isGitRepoKind } from '../../../shared/repo-kind'
import { getHqProjectPagesService } from '../../hq-project-pages/hq-project-pages-service'
import { startHqWaitingBells } from '../../hq-today/hq-waiting-bells'
import { startShipRestartNotice } from '../ship-restart/ship-restart-notice'
import { registerHqClickUpTriage } from '../../hq-today/register-hq-clickup-triage'

const BROADCAST_DEBOUNCE_MS = 50
const FEED_DAYS_MS = 3 * 24 * 60 * 60_000

function broadcastChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('pulseBell:changed')
    }
  }
}

export function registerPulseBell(
  store: Store,
  runtime: OrcaRuntimeService,
  rateLimits: RateLimitService
): void {
  const sync = (kind: string, desired: readonly PulseBellInput[]): void => {
    try {
      runtime.pulseSyncInboxKind(kind, desired)
    } catch (error) {
      console.warn(`[pulse-bell] ${kind} sync failed:`, error)
    }
  }

  const syncHandoffs = (offers: readonly ClaudeHandoffOffer[]): void =>
    sync(PULSE_BELL_KIND.handoff, offers.map(handoffBellItem))
  onClaudeHandoffOffersChanged(syncHandoffs)
  // Why: offers live in memory, so any left open by the last run are stale.
  syncHandoffs([])

  const waiting = createWaitingAgentsTracker((worktreeId) => describeWorktree(store, worktreeId))
  // Why: waiting states are re-announced by hydration; items from the last run are stale.
  sync(PULSE_BELL_KIND.agentWaiting, [])
  const syncWaiting = (): void =>
    sync(PULSE_BELL_KIND.agentWaiting, waiting.list().map(waitingAgentBellItem))
  bindAgentFinishedInbox({
    list: () => runtime.pulseListInbox(false),
    add: (input) => void runtime.pulseAddInboxItem(input),
    markDone: (id, action) => void runtime.pulseMarkInboxDone(id, action)
  })
  agentHookServer.subscribeEnrichedStatus((event) => {
    if (waiting.onStatus(event)) {
      syncWaiting()
    }
    if (event.payload.state === 'working' && !event.restoredUnconfirmed) {
      clearAgentFinished([event.paneKey], 'gone', event.stateStartedAt)
    }
  })
  const onPaneGone = (paneKey: string): void => {
    if (waiting.onCleared(paneKey)) {
      syncWaiting()
    }
  }
  // Why: a transient SSH clear is lost contact, not an exited agent; only pane-keyed clears count.
  agentHookServer.subscribePaneStatusClear((clear) => {
    if ('paneKey' in clear) {
      onPaneGone(clear.paneKey)
    }
  })
  agentHookServer.subscribeStatusDrop(onPaneGone)

  // Custom build (hq-slack-requests): Slack requests the owner has not decided, behind «New view».
  startHqSlackRequestBell({
    hqPath: () => store.getSettings().hqPath ?? null,
    enabled: () => store.getSettings().hqChatsView !== false,
    readScout: readHqSlackScout,
    listPages: listHqProjectPages,
    sync,
    onChanged: onHqSlackScoutChanged
  })
  // Custom build (hq-scout-digest): Slack in one bell item at the digest hours.
  startHqSlackDigest({
    hqPath: () => store.getSettings().hqPath ?? null,
    enabled: () => store.getSettings().hqChatsView !== false,
    readScout: readHqSlackScout,
    sync,
    now: () => new Date()
  })
  // Custom build (hq-clickup-requests): comments on the owner's ClickUp tasks join those requests.
  startHqClickUpRequests({
    hqPath: () => store.getSettings().hqPath ?? null,
    enabled: () => store.getSettings().hqChatsView !== false,
    collect: async (hq) => {
      const bindings = store.getSettings().hqProjectClickUpLists ?? {}
      const pages = await listHqProjectPages(hq).catch(() => [])
      return collectHqClickUpRequests(hq, {
        listMyTasks: () => listClickUpTasks({ scope: 'mine', includeDone: true }, 50),
        listComments: listClickUpTaskComments,
        viewer: getClickUpViewer,
        projectForList: (listId) => {
          const repoId = Object.entries(bindings).find(
            ([, binding]) => listId && binding.listId === listId
          )?.[0]
          return pages.find((page) => page.repoId === repoId)?.slug ?? null
        },
        now: Date.now
      })
    },
    onAdded: notifyHqSlackScoutChanged
  })

  // Custom build (hq-clickup-triage): task edits beyond comments, sorted by a small model.
  registerHqClickUpTriage(store, runtime, rateLimits)

  // Custom build (hq-waiting-replies): answers to what the chats wait for, offered back to those chats.
  registerHqWaitingReplies(store, runtime)
  // Custom build (ship-restart-notice): the chat that shipped this build is told to check it.
  startShipRestartNotice()
  // Custom build (hq-scout-context): whom the chats wait for and what was sent, for the Slack scout.
  startHqScoutContext({
    hqPath: () => store.getSettings().hqPath ?? null,
    listWaitings: () => runtime.pulseListWaitings({ status: 'open' }),
    listDecisions: () => runtime.pulseListDecisions(100),
    personName: (id) => runtime.pulseListPeople().find((person) => person.id === id)?.name ?? null,
    peopleNames: () => runtime.pulseListPeople().map((person) => person.name)
  })
  // Custom build (hq-feed): one timeline of what happened around the owner, for HQ's Feed.
  startHqFeed({
    hqPath: () => store.getSettings().hqPath ?? null,
    decisions: () => runtime.pulseListDecisions(100),
    drafts: () => runtime.pulseListDrafts('sent'),
    // Why: SSH and folder projects are skipped — a remote git per project every five minutes is too much.
    commits: () =>
      readHqFeedCommits(
        store
          .getRepos()
          .filter((repo) => !repo.connectionId && isGitRepoKind(repo))
          .map((repo) => ({ path: repo.path, name: repo.displayName })),
        async (cwd) => (await gitExecFileAsync(HQ_FEED_COMMIT_LOG_ARGS, { cwd })).stdout
      ),
    finishedAgents: () =>
      runtime.pulseListInbox(true, {
        kind: PULSE_BELL_KIND.agentFinished,
        since: Date.now() - FEED_DAYS_MS
      }),
    reviews: async () => (await getHqProjectPagesService()?.reviews(false))?.reviews ?? [],
    upsert: (items) => void runtime.pulseUpsertFeed(items),
    now: Date.now
  })
  // Custom build (hq-feed-posts): the work done, as short posts in Russian.
  startHqFeedPosts({
    pending: (limit) => runtime.pulseFeedWithoutPost(limit),
    save: (posts) => runtime.pulseSetFeedPosts(posts),
    generate: async (prompt) => {
      const hqPath = store.getSettings().hqPath
      return hqPath
        ? generateHqText(
            prompt,
            { emptyResultName: 'feed posts', operation: 'hq-feed-posts' },
            {
              settings: store.getSettings(),
              cwd: hqPath,
              getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
            }
          )
        : { ok: false, error: 'No HQ folder is set.' }
    },
    now: Date.now
  })
  // Custom build (hq-reports): a new report in HQ reaches the bell and the phone.
  startHqReportBell({
    hqPath: () => store.getSettings().hqPath ?? null,
    sync: (kind, items) => runtime.pulseSyncInboxKind(kind, items).raised,
    notify: (report) =>
      void runtime.dispatchPluginNotification({
        pluginId: 'HQ',
        title: 'New report',
        body: report.title
      }),
    now: Date.now
  })
  // Custom build (hq-promises): the owner's Slack promises into Notes, and a bell line the day before.
  startHqScoutPromises({
    hqPath: () => store.getSettings().hqPath ?? null,
    listWaitings: () => runtime.pulseListWaitings(),
    listPeople: () => runtime.pulseListPeople(),
    upsertPerson: (input) => runtime.pulseUpsertPerson(input),
    addWaiting: (input) => runtime.pulseAddWaiting(input),
    closeWaiting: (id, resolution) => void runtime.pulseCloseWaiting(id, 'resolved', resolution)
  })
  // Custom build (hq-people): pulse people get their Slack/ClickUp ids and role from HQ's org matrix.
  startHqPeopleSync({
    hqPath: () => store.getSettings().hqPath ?? null,
    listPeople: () => runtime.pulseListPeople(),
    upsertPerson: (input) => runtime.pulseUpsertPerson(input)
  })
  // Custom build (hq-remind): and people who have not answered for two working days.
  startHqWaitingBells({
    listOpen: () => runtime.pulseListWaitings({ status: 'open' }),
    personName: (id) => runtime.pulseListPeople().find((person) => person.id === id)?.name ?? null,
    sync,
    onChanged: onPulseChanged,
    now: Date.now
  })
  // Custom build (hq-clickup-waiting): answers to questions asked in ClickUp comments, the same way.
  const clickUpTaskIds = new Map<string, string>()
  startHqClickUpWaitingReplies({
    listOpen: () => runtime.pulseListWaitings({ status: 'open' }),
    taskId: async (ref) => {
      const known = clickUpTaskIds.get(ref)
      if (known) {
        return known
      }
      const id = (await getClickUpTask(ref))?.id ?? null
      if (id) {
        clickUpTaskIds.set(ref, id)
      }
      return id
    },
    listComments: listClickUpTaskComments,
    listReplies: listClickUpCommentReplies,
    viewer: getClickUpViewer,
    clickUpUserId: (personId) =>
      runtime.pulseListPeople().find((person) => person.id === personId)?.clickupUserId ?? null,
    recordReply: (id, reply) => runtime.pulseRecordWaitingReply(id, reply)
  })

  let timer: ReturnType<typeof setTimeout> | null = null
  onPulseChanged(() => {
    if (timer) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      broadcastChanged()
    }, BROADCAST_DEBOUNCE_MS)
  })

  ipcMain.handle('pulseBell:list', (): PulseInboxItem[] => runtime.pulseListInbox(false))
  ipcMain.handle('pulseBell:markRead', (_event, ids: unknown) => {
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id === 'string') {
        runtime.pulseMarkInboxRead(id)
      }
    }
  })
  ipcMain.handle('pulseBell:markDone', (_event, id: unknown, action: unknown) => {
    if (typeof id === 'string') {
      runtime.pulseMarkInboxDone(id, typeof action === 'string' ? action : undefined)
    }
  })
  ipcMain.handle('pulseBell:syncKind', (_event, kind: unknown, items: unknown) => {
    if (typeof kind !== 'string' || !RENDERER_SYNCED_PULSE_BELL_KINDS.includes(kind)) {
      return
    }
    sync(kind, readPulseBellInputs(items))
  })
}
