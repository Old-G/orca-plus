// Custom build (hq-plus-sessions): starts HQ+'s session dispatcher — `orca hq dispatch` and
// `orca hq sessions`, a sweep every two minutes (queue, handoffs), and the close check chat cleanup
// asks before it closes a chat.
// Custom build (hq-handoff-auto): a new handoff also sweeps once its grace is over.
import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { HqJournalService } from '../hq-journal/hq-journal-service'
import { getHqThreads } from '../hq-journal/hq-journal-threads'
import { hqPlaceOf } from '../hq-journal/hq-journal-rooms'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { launchHqBackgroundChat, limitHqChatToAuto } from '../hq-today/hq-background-chat'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { getClaudeHandoffLauncher, onClaudeHandoffOffersChanged } from '../ipc/claude-handoff'
import { claudeLimitStoppedNow } from '../ipc/claude-limit-guard'
import { HQ_JOURNAL_KIND, HQ_JOURNAL_MAX_LIMIT } from '../../shared/hq-journal'
import {
  HQ_SESSION_DISPATCH_DEFAULT_MODE,
  HQ_SESSION_HANDOFF_AUTO_GRACE_MS,
  HQ_SESSION_QUIET_MS,
  type HqMayCloseResult
} from '../../shared/hq-sessions'
import { selectStructuredAgentContextUsage } from '../../shared/structured-agent-session-context-usage'
import { getRepoMainWorktreeId, splitWorktreeId } from '../../shared/worktree/id'
import { createHqSessions, provideHqSessions } from './hq-sessions'
import {
  hqChatSessionOf,
  hqLiveSessions,
  hqAddressOpenChats,
  type HqAgentSighting,
  type HqChatTab
} from './hq-session-live'

const SWEEP_MS = 2 * 60_000
const SENDER = 'hq-sessions'
// Why: a week back covers every chat the dispatcher could continue (12 h) or report as lost.
const SESSIONS_BACK_MS = 7 * 24 * 60 * 60_000
const CONTEXT_READ_MS = 3_000
const WORKTREE_PS_LIMIT = 500
// Why: the sweep after a new handoff runs just past its grace, not on the edge of it.
const HANDOFF_SWEEP_SLACK_MS = 2_000

/** The chat's context share, as its own journal last measured it; null when unknown or slow. */
async function readContextPct(sessionId: string): Promise<number | null> {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return null
  }
  const read = host
    .readOptions(sessionId)
    .then((options) =>
      options.contextUsage
        ? (selectStructuredAgentContextUsage([], options.contextUsage.current)?.percentage ?? null)
        : null
    )
    .catch(() => null)
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CONTEXT_READ_MS))
  return Promise.race([read, timeout])
}

function chatTabs(store: Store): HqChatTab[] {
  const session = store.getWorkspaceSession()
  const tabs: HqChatTab[] = []
  for (const [worktreeId, list] of Object.entries(session.unifiedTabs ?? {})) {
    const groups = session.tabGroups?.[worktreeId] ?? []
    const activeGroup = groups.find(
      (group) => group.id === session.activeGroupIdByWorktree?.[worktreeId]
    )
    for (const tab of list) {
      const sessionId = hqChatSessionOf(tab.id)
      if (!sessionId) {
        continue
      }
      tabs.push({
        sessionId,
        worktreeId,
        lastFocusedAt: tab.lastFocusedAt ?? null,
        focused: session.activeWorktreeId === worktreeId && activeGroup?.activeTabId === tab.id
      })
    }
  }
  return tabs
}

export function registerHqSessions(
  store: Store,
  runtime: OrcaRuntimeService,
  journal: HqJournalService
): void {
  const hqPath = (): string | null => store.getSettings().hqPath ?? null
  const record = (sessionId: string) => {
    try {
      return runtime.openedAgentSessionRecordStore()?.getRecord(sessionId) ?? null
    } catch {
      return null
    }
  }
  const agents = async (): Promise<HqAgentSighting[]> => {
    const ps = await runtime.getWorktreePs(WORKTREE_PS_LIMIT).catch(() => null)
    return (ps?.worktrees ?? []).flatMap((worktree) =>
      worktree.agents.flatMap((agent) => {
        const sessionId = hqChatSessionOf(agent.paneKey)
        return sessionId
          ? [
              {
                sessionId,
                state: agent.mainAgent?.state ?? agent.state,
                updatedAt: agent.updatedAt
              }
            ]
          : []
      })
    )
  }
  const autoHandoff = (): boolean => store.getSettings().hqHandoffAutoStart !== false
  const service = createHqSessions({
    mode: () => store.getSettings().hqSessionDispatcher ?? HQ_SESSION_DISPATCH_DEFAULT_MODE,
    enabled: () => store.getSettings().hqPlusJournalEnabled !== false,
    autoHandoff,
    roomOf: async (project) => hqPlaceOf(await journal.sources(), { project }).room,
    dispatcherCaller: () => ({ cwd: hqPath() }),
    pulse: {
      list: (query) => runtime.pulseListJournal(query),
      record: (inputs) => runtime.pulseRecordJournal(inputs),
      noteSessions: (inputs) => runtime.pulseNoteSessions(inputs),
      getSession: (sessionId) => runtime.pulseGetSession(sessionId)
    },
    live: async (addresses = []) => {
      const now = Date.now()
      const sessions = runtime.pulseListRecentSessions(now - SESSIONS_BACK_MS)
      const sources = await journal.sources()
      const asking = new Set(
        runtime
          .pulseListJournal({
            kind: HQ_JOURNAL_KIND.chatReport,
            needs: 'owner',
            status: 'open',
            limit: HQ_JOURNAL_MAX_LIMIT
          })
          .flatMap((entry) => (entry.sessionId ? [entry.sessionId] : []))
      )
      const contextPct = new Map<string, number>()
      // Why: reading a chat's context opens its journal; only threads being dispatched need it.
      for (const session of sessions.filter(
        (candidate) =>
          candidate.address !== null &&
          addresses.includes(candidate.address) &&
          now - candidate.lastActivityAt < HQ_SESSION_QUIET_MS
      )) {
        const pct = await readContextPct(session.sessionId)
        if (pct !== null) {
          contextPct.set(session.sessionId, pct)
        }
      }
      const seen = hqLiveSessions({
        sessions,
        agents: await agents(),
        tabs: chatTabs(store),
        asking,
        contextPct,
        name: (sessionId) => record(sessionId)?.conversationName?.trim() || null,
        placeOfWorktree: (worktreeId) => {
          const place = hqPlaceOf(sources, { worktreeId })
          return { project: place.project, workspace: place.room }
        },
        windowFocused: BrowserWindow.getAllWindows().some(
          (window) => !window.isDestroyed() && window.isFocused()
        ),
        now
      })
      const { live, notes } = hqAddressOpenChats(
        seen,
        (sessionId) => runtime.pulseGetSession(sessionId),
        now
      )
      if (notes.length > 0) {
        runtime.pulseNoteSessions(notes)
      }
      return live
    },
    send: async (caller, message) => {
      const threads = getHqThreads()
      if (!threads) {
        throw new Error('HQ+ threads are not available on this host.')
      }
      return threads.send(caller, message)
    },
    workspaceFor: async (project, worktreeId) => {
      const hq = hqPath()
      const page = hq
        ? (await listHqProjectPages(hq).catch(() => [])).find((entry) => entry.slug === project)
        : undefined
      const repo = page ? store.getRepo(page.repoId) : undefined
      if (!repo) {
        return null
      }
      // Why: a chat taking a thread over works where the last one did, if that workspace is still there.
      const kept = worktreeId && splitWorktreeId(worktreeId)?.repoId === repo.id ? worktreeId : null
      return { worktreeId: kept ?? getRepoMainWorktreeId(repo), name: repo.displayName }
    },
    launch: (worktreeId) => launchHqBackgroundChat(runtime, { kind: 'existing', worktreeId }),
    limit: (sessionId) => limitHqChatToAuto(sessionId, SENDER),
    nameChat: async (sessionId, name) => {
      await runtime
        .openedAgentSessionRecordStore()
        ?.compareAndSetConversationName(sessionId, name, null)
        .catch(() => null)
    },
    deliver: (sessionId, prompt) => deliverToNativeChat(sessionId, prompt, SENDER),
    offers: () => {
      const stopped = new Set(
        claudeLimitStoppedNow().flatMap((stop) =>
          [stop.key, stop.sessionId].filter((id): id is string => Boolean(id))
        )
      )
      return (getClaudeHandoffLauncher()?.list() ?? []).map((offer) => {
        const sessionId = offer.tabId ? hqChatSessionOf(offer.tabId) : null
        return {
          id: offer.id,
          sessionId,
          raisedAt: offer.raisedAt ?? (Date.parse(offer.created) || Date.now()),
          limitStopped: stopped.has(offer.id) || (sessionId !== null && stopped.has(sessionId))
        }
      })
    },
    startHandoff: async (offerId) => {
      const launcher = getClaudeHandoffLauncher()
      if (!launcher) {
        return { ok: false, error: 'Handoffs are not available on this host.' }
      }
      const launched = await launcher.launch(offerId)
      return launched.ok ? { ok: true } : launched
    },
    sync: async () => {
      await journal.sync()
    },
    now: Date.now,
    log: (message) => console.log('[hq-sessions]', message)
  })
  provideHqSessions(service)
  ipcMain.handle(
    'hqProjects:mayCloseChat',
    async (_event, ref: unknown): Promise<HqMayCloseResult> => {
      const sessionId: unknown =
        ref && typeof ref === 'object' ? Reflect.get(ref, 'sessionId') : null
      return typeof sessionId === 'string'
        ? service.mayClose(sessionId, 'cleanup')
        : { ok: false, why: 'no chat named' }
    }
  )
  const sweep = (): void => {
    void service
      .sweep({ run: true })
      .catch((error: unknown) => console.warn('[hq-sessions] sweep failed:', error))
  }
  const timer = setInterval(() => {
    if (store.getSettings().hqSessionDispatcher === 'off' && !autoHandoff()) {
      return
    }
    sweep()
  }, SWEEP_MS)
  timer.unref?.()
  // Why: the two-minute timer alone would leave the owner a dead chat for up to two minutes.
  let listed = new Set<string>()
  onClaudeHandoffOffersChanged((offers) => {
    const keys = new Set(offers.map((offer) => `${offer.id}\n${offer.created}`))
    const fresh = [...keys].some((key) => !listed.has(key))
    listed = keys
    if (fresh && autoHandoff()) {
      setTimeout(sweep, HQ_SESSION_HANDOFF_AUTO_GRACE_MS + HANDOFF_SWEEP_SLACK_MS).unref?.()
    }
  })
}
