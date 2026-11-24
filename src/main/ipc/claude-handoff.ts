// Custom build (claude-handoff-launch): offers a fresh Claude session when one stops after writing a
// handoff, and starts it on the workspace's execution host through the same `agent.launch` RPC.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import { PulseDb, pulseDbPath } from '../orca-plus/pulse/pulse-db'
import {
  createClaudeHandoffOffers,
  type ClaudeHandoffOffers
} from '../claude-handoff/claude-handoff-offers'
import {
  createFileHandledStore,
  strataContextGateFired
} from '../claude-handoff/claude-handoff-offer-state'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { AGENT_LAUNCH_METHODS } from '../runtime/rpc/methods/agent-launch/agent-launch'
import type {
  ClaudeHandoffLaunchResult,
  ClaudeHandoffOffer
} from '../../shared/claude-handoff-file'
import { getRuntimePathBasename } from '../../shared/file-access/cross-platform-path'
import { splitWorktreeId } from '../../shared/worktree/id'
import { getHqThreads } from '../hq-journal/hq-journal-threads'
import type { HqChatRole } from '../../shared/hq-chat-role'
import { getHqSessions } from '../hq-sessions/hq-sessions'
import {
  claudeHandoffSuccessorStarted,
  readClaudeHandoffWorktreeFile
} from '../claude-handoff/claude-handoff-worktree-files'
import {
  claudeHandoffSuccessorSessionOptions,
  claudeHandoffSuccessorWorktreeId,
  closeClaudeHandedOffChat,
  readLaunchedTabId
} from '../claude-handoff/claude-handoff-successor'
import { createClaudeContinueChat } from '../claude-handoff/claude-handoff-continue-chat'
import { startClaudeHandoffOnce } from '../claude-handoff/claude-handoff-start-once'

const NATIVE_CHAT_TAB = 'structured-agent-session-'

/** The chat a successor continues: where it runs and its tab. */
type ClaudeHandoffSource = Pick<ClaudeHandoffOffer, 'worktreeId' | 'tabId' | 'tabWorktreeId'>

function nativeChatSessionId(tabId: string | undefined): string | null {
  return tabId?.startsWith(NATIVE_CHAT_TAB) ? tabId.slice(NATIVE_CHAT_TAB.length) : null
}

/** Custom build (hq-waiting-replies): an answer to a question the old chat asked reaches its successor. */
function moveWaitingsToSuccessor(
  pulseDb: () => PulseDb,
  offer: ClaudeHandoffSource,
  launchedTabId: string | undefined
): void {
  const from = nativeChatSessionId(offer.tabId)
  const to = nativeChatSessionId(launchedTabId)
  if (!from || !to || from === to) {
    return
  }
  try {
    pulseDb().moveOpenWaitingsToChat(from, to)
  } catch (error) {
    console.warn('[claude-handoff] moving waitings to the new chat failed:', error)
  }
}

/** Custom build (chat-cleanup): the chat that wrote the handoff is done once its successor starts;
 *  closed like the tab's ×, so it stays reopenable from History. */
async function closeHandedOffChat(
  runtime: OrcaRuntimeService,
  offer: ClaudeHandoffSource,
  launchedTabId: string | undefined
): Promise<void> {
  if (!offer.tabId?.startsWith(NATIVE_CHAT_TAB) || offer.tabId === launchedTabId) {
    return
  }
  // Custom build (hq-plus-sessions): the close is a step of the thread's life in the journal.
  await getHqSessions()
    ?.mayClose(offer.tabId.slice(NATIVE_CHAT_TAB.length), 'handoff')
    .catch(() => null)
  await closeClaudeHandedOffChat(
    {
      closeInRuntime: (worktreeSelector, tabId) =>
        runtime.closeMobileSessionTab(worktreeSelector, tabId, { reason: 'user' }),
      closeInWindow: (tabId) => {
        const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
        for (const window of windows) {
          window.webContents.send('claudeHandoff:closeChat', tabId)
        }
        return windows.length > 0
      },
      log: (message) => console.warn('[claude-handoff]', message)
    },
    offer,
    launchedTabId
  )
}

type OffersListener = (offers: ClaudeHandoffOffer[]) => void
const offersListeners = new Set<OffersListener>()

/** Custom build (pulse-bell): lets the bell mirror the offers the toast shows. */

function handedOnRole(runtime: OrcaRuntimeService, sessionId: string): HqChatRole | null {
  try {
    return runtime.pulseChats().roleOf(sessionId)
  } catch {
    return null
  }
}

export function onClaudeHandoffOffersChanged(listener: OffersListener): () => void {
  offersListeners.add(listener)
  return () => offersListeners.delete(listener)
}

function broadcastOffers(offers: ClaudeHandoffOffer[]): void {
  for (const listener of offersListeners) {
    try {
      listener(offers)
    } catch (error) {
      console.warn('[claude-handoff] offers listener failed:', error)
    }
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('claudeHandoff:offersChanged', offers)
    }
  }
}

/** Custom build (claude-handoff-model): the old chat's saved options — its model and effort among them. */
function handedOnOptions(
  runtime: OrcaRuntimeService,
  sessionId: string
): Readonly<Record<string, string>> | undefined {
  try {
    return runtime.openedAgentSessionRecordStore()?.getRecord(sessionId)?.options
  } catch {
    return undefined
  }
}

export function describeWorktree(store: Store, worktreeId: string): string {
  const parsed = splitWorktreeId(worktreeId)
  const repo = parsed ? store.getRepo(parsed.repoId) : undefined
  const name =
    store.getWorktreeMeta(worktreeId)?.displayName.trim() ||
    (parsed ? getRuntimePathBasename(parsed.worktreePath) : worktreeId)
  return repo && repo.displayName !== name ? `${repo.displayName} / ${name}` : name
}

/** The gate marker lives in this machine's TMPDIR, so only a local workspace can be checked. */
function isLocalWorktree(store: Store, worktreeId: string): boolean {
  const parsed = splitWorktreeId(worktreeId)
  const repo = parsed ? store.getRepo(parsed.repoId) : undefined
  return Boolean(repo && !repo.connectionId && !repo.executionHostId?.startsWith('runtime:'))
}

export function registerClaudeHandoffHandlers(
  store: Store,
  runtime: OrcaRuntimeService
): ClaudeHandoffOffers {
  const dispatcher = new RpcDispatcher({ runtime, methods: AGENT_LAUNCH_METHODS })
  const offers = createClaudeHandoffOffers({
    readWorktreeFile: (worktreeId, relativePath) =>
      readClaudeHandoffWorktreeFile(store, worktreeId, relativePath),
    describeWorktree: (worktreeId) => describeWorktree(store, worktreeId),
    onOffersChanged: broadcastOffers,
    contextGateFired: async (worktreeId, sessionId) =>
      isLocalWorktree(store, worktreeId) ? strataContextGateFired(sessionId) : null,
    handled: createFileHandledStore(join(app.getPath('userData'), 'claude-handoff-handled.json')),
    successorStarted: (handoff) => claudeHandoffSuccessorStarted(store, runtime, handoff),
    siblingWorktrees: (worktreeId) => {
      const repoId = splitWorktreeId(worktreeId)?.repoId
      return repoId
        ? Object.keys(store.getAllWorktreeMeta()).filter(
            (id) => id !== worktreeId && splitWorktreeId(id)?.repoId === repoId
          )
        : []
    }
  })
  const launching = new Set<string>()
  let db: PulseDb | null = null
  const pulseDb = (): PulseDb => (db ??= new PulseDb(pulseDbPath(app.getPath('userData'))))

  agentHookServer.subscribeEnrichedStatus((event) => {
    void offers.onStatus(event).catch((error: unknown) => {
      console.warn('[claude-handoff] check failed:', error instanceof Error ? error.message : error)
    })
  })

  ipcMain.handle('claudeHandoff:list', () => offers.list())
  ipcMain.handle('claudeHandoff:dismiss', (_event, id: unknown) => {
    if (typeof id === 'string') {
      offers.dismiss(id)
    }
  })
  /**
   * Starts the chat that continues `from` with `prompt`: on the old chat's model, effort and role, on its
   * thread, with its waitings; the old chat closes unless `keepOld`. Shared by a handoff file's offer
   * and by «Continue in new chat» (T6), which has no file.
   */
  const startSuccessor = async (args: {
    worktreeId: string
    from: ClaudeHandoffSource
    prompt: string
    presentation?: 'background'
    keepOld: boolean
    /** The old chat's model and effort read on its own runtime; the local record when absent. */
    options?: Readonly<Record<string, string>>
    /** Runs once the new chat started, before the old one closes. */
    onStarted?: () => void
  }): Promise<{ ok: true; tabId: string | undefined } | { ok: false; error: string }> => {
    const { worktreeId, from, prompt, presentation, keepOld, options, onStarted } = args
    const fromSessionId = nativeChatSessionId(from.tabId)
    // Custom build (hq-chat-roles, claude-handoff-model): the successor starts with the old chat's
    // role in its env, on the old chat's model and effort.
    const sessionOptions = fromSessionId
      ? claudeHandoffSuccessorSessionOptions(
          // Why the window's first: a chat on a paired runtime has its record there, not here.
          options ?? handedOnOptions(runtime, fromSessionId),
          handedOnRole(runtime, fromSessionId)
        )
      : undefined
    const response = await dispatcher.dispatch({
      id: randomUUID(),
      authToken: '',
      method: 'agent.launch',
      params: {
        agent: 'claude',
        target: { kind: 'existing', worktree: `id:${worktreeId}` },
        prompt: { text: prompt, delivery: 'submit' },
        ...(sessionOptions ? { sessionOptions } : {}),
        // Custom build (hq-plus-sessions): a successor the dispatcher starts opens beside the owner's work.
        ...(presentation ? { presentation, nativeChatDefault: true } : {})
      }
    })
    if (!response.ok) {
      return { ok: false, error: response.error.message }
    }
    onStarted?.()
    const tabId = readLaunchedTabId(response.result)
    // Custom build (hq-plus-reports): the new chat continues the old one's thread. Why first: the
    // sessions sweep would otherwise give the open, unaddressed successor a fresh `-2` address.
    const toSessionId = nativeChatSessionId(tabId)
    if (fromSessionId && toSessionId) {
      getHqThreads()?.handoff(fromSessionId, toSessionId)
    }
    moveWaitingsToSuccessor(pulseDb, from, tabId)
    if (!keepOld) {
      await closeHandedOffChat(runtime, from, tabId)
    }
    return { ok: true, tabId }
  }
  const launch = async (
    id: string,
    presentation?: 'background',
    // Custom build (claude-handoff-launch): the owner may keep the old chat open beside the new one.
    keepOld = false
  ): Promise<ClaudeHandoffLaunchResult> => {
    if (launching.has(id)) {
      return { ok: false, error: 'This handoff is already starting.' }
    }
    launching.add(id)
    try {
      const resolved = await offers.resolve(id)
      if (!resolved) {
        return { ok: false, error: 'The handoff file is gone or no longer valid.' }
      }
      const worktreeId = claudeHandoffSuccessorWorktreeId(resolved.offer)
      const started = await startClaudeHandoffOnce({
        fromSessionId: nativeChatSessionId(resolved.offer.tabId),
        ownStarted: () =>
          claudeHandoffSuccessorStarted(store, runtime, resolved.offer).catch(() => false),
        dismiss: () => offers.dismiss(id),
        start: () =>
          startSuccessor({
            worktreeId,
            from: resolved.offer,
            prompt: resolved.file.prompt,
            presentation,
            keepOld,
            onStarted: () => offers.dismiss(id)
          }),
        card: { runtime, task: resolved.file.prompt }
      })
      if (!started.ok) {
        return started
      }
      return { ok: true, worktreeId, ...(started.tabId ? { tabId: started.tabId } : {}) }
    } finally {
      launching.delete(id)
    }
  }
  // Custom build (chat-continue-new, T6): «Continue in new chat» — no handoff file; the window sends the prompt.
  const continueChat = createClaudeContinueChat(async ({ worktreeId, from, prompt, options }) => {
    const started = await startSuccessor({ worktreeId, from, prompt, options, keepOld: false })
    return started.ok
      ? { ok: true, worktreeId, ...(started.tabId ? { tabId: started.tabId } : {}) }
      : started
  })
  ipcMain.handle('claudeHandoff:continueChat', (_event, worktreeId, tabId, prompt, options) =>
    continueChat(worktreeId, tabId, prompt, options)
  )
  ipcMain.handle(
    'claudeHandoff:launch',
    async (_event, id: unknown, keepOld: unknown): Promise<ClaudeHandoffLaunchResult> =>
      typeof id === 'string'
        ? launch(id, undefined, keepOld === true)
        : { ok: false, error: 'This handoff is already starting.' }
  )
  provideClaudeHandoffLauncher({
    list: () => offers.list(),
    // Custom build (hq-plus-all-open-chats, owner 02.11): a successor started for him leaves the old chat
    // open; he closes it himself once he sees the new one took over.
    launch: (id) => launch(id, 'background', true)
  })
  return offers
}

/** Custom build (hq-plus-sessions): the offers and their launch, for the session dispatcher. */
export type ClaudeHandoffLauncher = {
  list: () => ClaudeHandoffOffer[]
  launch: (id: string) => Promise<ClaudeHandoffLaunchResult>
}

let launcher: ClaudeHandoffLauncher | null = null

function provideClaudeHandoffLauncher(value: ClaudeHandoffLauncher): void {
  launcher = value
}

export function getClaudeHandoffLauncher(): ClaudeHandoffLauncher | null {
  return launcher
}
