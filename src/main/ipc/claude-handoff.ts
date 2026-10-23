// Custom build (claude-handoff-launch): offers a fresh Claude session when one stops after writing a
// handoff, and starts it on the workspace's execution host through the same `agent.launch` RPC.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { agentHookServer } from '../agent-hooks/server'
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
import { AGENT_LAUNCH_METHODS } from '../runtime/rpc/methods/agent-launch'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import type {
  ClaudeHandoffLaunchResult,
  ClaudeHandoffOffer
} from '../../shared/claude-handoff-file'
import { getRuntimePathBasename } from '../../shared/cross-platform-path'
import { splitWorktreeId } from '../../shared/worktree/id'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { getHqThreads } from '../hq-journal/hq-journal-threads'

/** The tab the launch opened, so HQ can show the new chat in place; absent from older hosts. */
function readLaunchedTabId(result: unknown): string | undefined {
  const outcome: unknown =
    result && typeof result === 'object' ? Reflect.get(result, 'outcome') : null
  if (!outcome || typeof outcome !== 'object') {
    return undefined
  }
  const tabId: unknown = Reflect.get(outcome, 'tabId')
  if (typeof tabId === 'string') {
    return tabId
  }
  const paneKey: unknown = Reflect.get(outcome, 'paneKey')
  return typeof paneKey === 'string' ? parsePaneKey(paneKey)?.tabId : undefined
}

const NATIVE_CHAT_TAB = 'structured-agent-session-'

function nativeChatSessionId(tabId: string | undefined): string | null {
  return tabId?.startsWith(NATIVE_CHAT_TAB) ? tabId.slice(NATIVE_CHAT_TAB.length) : null
}

/** Custom build (hq-waiting-replies): an answer to a question the old chat asked reaches its successor. */
function moveWaitingsToSuccessor(
  pulseDb: () => PulseDb,
  offer: ClaudeHandoffOffer,
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
  offer: ClaudeHandoffOffer,
  launchedTabId: string | undefined
): Promise<void> {
  if (!offer.tabId?.startsWith(NATIVE_CHAT_TAB) || offer.tabId === launchedTabId) {
    return
  }
  try {
    await runtime.closeMobileSessionTab(`id:${offer.worktreeId}`, offer.tabId, { reason: 'user' })
  } catch (error) {
    console.warn('[claude-handoff] closing the handed-off chat failed:', error)
  }
}

type OffersListener = (offers: ClaudeHandoffOffer[]) => void
const offersListeners = new Set<OffersListener>()

/** Custom build (pulse-bell): lets the bell mirror the offers the toast shows. */
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

async function readWorktreeFile(
  store: Store,
  worktreeId: string,
  relativePath: string
): Promise<string | null> {
  const parsed = splitWorktreeId(worktreeId)
  const repo = parsed ? store.getRepo(parsed.repoId) : undefined
  // Why: a runtime-host workspace lives on another Orca, which reads its own files.
  if (!parsed || !repo || repo.executionHostId?.startsWith('runtime:')) {
    return null
  }
  const path = joinWorktreeRelativePath(parsed.worktreePath, relativePath)
  try {
    // Why: the file sits on the SSH host, which this process cannot read; unknown, not "absent".
    return repo.connectionId ? null : await readFile(path, 'utf-8')
  } catch {
    return null
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
      readWorktreeFile(store, worktreeId, relativePath),
    describeWorktree: (worktreeId) => describeWorktree(store, worktreeId),
    onOffersChanged: broadcastOffers,
    contextGateFired: async (worktreeId, sessionId) =>
      isLocalWorktree(store, worktreeId) ? strataContextGateFired(sessionId) : null,
    handled: createFileHandledStore(join(app.getPath('userData'), 'claude-handoff-handled.json'))
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
  ipcMain.handle(
    'claudeHandoff:launch',
    async (_event, id: unknown): Promise<ClaudeHandoffLaunchResult> => {
      if (typeof id !== 'string' || launching.has(id)) {
        return { ok: false, error: 'This handoff is already starting.' }
      }
      launching.add(id)
      try {
        const resolved = await offers.resolve(id)
        if (!resolved) {
          return { ok: false, error: 'The handoff file is gone or no longer valid.' }
        }
        const response = await dispatcher.dispatch({
          id: randomUUID(),
          authToken: '',
          method: 'agent.launch',
          params: {
            agent: 'claude',
            target: { kind: 'existing', worktree: `id:${resolved.offer.worktreeId}` },
            prompt: { text: resolved.file.prompt, delivery: 'submit' }
          }
        })
        if (!response.ok) {
          return { ok: false, error: response.error.message }
        }
        offers.dismiss(id)
        const tabId = readLaunchedTabId(response.result)
        moveWaitingsToSuccessor(pulseDb, resolved.offer, tabId)
        await closeHandedOffChat(runtime, resolved.offer, tabId)
        // Custom build (hq-plus-reports): the new chat continues the old one's thread.
        if (
          resolved.offer.tabId?.startsWith(NATIVE_CHAT_TAB) &&
          tabId?.startsWith(NATIVE_CHAT_TAB)
        ) {
          getHqThreads()?.handoff(
            resolved.offer.tabId.slice(NATIVE_CHAT_TAB.length),
            tabId.slice(NATIVE_CHAT_TAB.length)
          )
        }
        return { ok: true, worktreeId: resolved.offer.worktreeId, ...(tabId ? { tabId } : {}) }
      } finally {
        launching.delete(id)
      }
    }
  )
  return offers
}
