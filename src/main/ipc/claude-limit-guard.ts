// Custom build (claude-limit-guard): remembers Claude agents that stopped on a usage limit — terminals
// through the StopFailure hook, native chats through their stream frames — and nudges only those
// (Esc + a continue prompt) once another account is active or the limit lifted.
import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RateLimitService } from '../rate-limits/service'
import { agentHookServer } from '../agent-hooks/server'
import { normalizeClaudeRuntimeSelection } from '../claude-accounts/runtime-selection'
import type { ClaudeHandoffOffers } from '../claude-handoff/claude-handoff-offers'
import { createClaudeLimitStops } from '../claude-limit-guard/claude-limit-stops'
import { setClaudeNativeFrameListener } from '../claude-limit-guard/claude-native-frame-tap'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { readStructuredSessionGateFacts } from '../runtime/orchestration/structured-mailbox-pointer-host'
import { mintAgentSessionOperationId } from '../runtime/orchestration/structured-pointer-operation-id'
import { sendAgentTurn } from '../runtime/orchestration/send-agent-turn'
import { mainProcessState } from '../startup/main-process-state'
import {
  CLAUDE_LIMIT_CONTINUE_PROMPT,
  claudeLimitStopIsAuth,
  claudeLimitsAccountId,
  type ClaudeLimitStoppedAgent
} from '../../shared/claude-limit-guard'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import { claudeAuthStopBellItem, PULSE_BELL_KIND } from '../../shared/pulse-bell'
import {
  claudeChatSubscriptionIdOf,
  continueChatOnSubscription,
  limitStoppedChatItems,
  type ClaudeChatLimitContinueDeps
} from '../claude-limit-guard/claude-chat-limit-continue'
import { prepareClaudeSubscriptionHome } from '../claude-subscriptions/claude-subscription-home'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'

const ESCAPE = '\x1b'
// Why: the TUI must settle the Esc before the prompt arrives, or both land in one input event.
const ESC_SETTLE_MS = 400
// Why: switching rewrites the shared Claude credentials; a nudge sent first would run on the old account.
const SWITCH_SETTLE_MS = 3_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function broadcast(stops: ClaudeLimitStoppedAgent[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('claudeLimitGuard:stopsChanged', stops)
    }
  }
}

async function resumeTerminal(runtime: OrcaRuntimeService, paneKey: string): Promise<boolean> {
  const handle = runtime.getTerminalHandleForPaneKey(paneKey)
  if (!handle) {
    return false
  }
  await runtime.sendTerminal(handle, { text: ESCAPE }, { inputKind: 'driving' })
  await delay(ESC_SETTLE_MS)
  await runtime.sendTerminal(
    handle,
    { text: CLAUDE_LIMIT_CONTINUE_PROMPT, enter: true },
    { inputKind: 'driving' }
  )
  return true
}

async function resumeNativeChat(sessionId: string): Promise<boolean> {
  const host = getStructuredAgentSessionHost()
  const fence = host?.deps.store.getRecord(sessionId)?.lease.runtimeFence
  const gate = await readStructuredSessionGateFacts(sessionId)
  // Why: a running turn means someone already resumed it; an unattached session cannot take input.
  if (!host || !fence || !gate || gate.turnRunning) {
    return false
  }
  const body: AgentJournalMessageItem = {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: CLAUDE_LIMIT_CONTINUE_PROMPT }]
  }
  const outcome = await sendAgentTurn({
    kind: 'structured-session',
    host,
    sessionId,
    callerKey: `trusted-local:claude-limit-guard:${sessionId}`,
    turn: {
      body,
      operationId: mintAgentSessionOperationId(Date.now()),
      expectedRuntimeFence: fence,
      delivery: 'now'
    }
  })
  return outcome.kind !== 'refused'
}

function nativeChatWorktreeId(sessionId: string): string | null {
  const tabs = getStructuredAgentSessionHost()?.listSessionTabs() ?? []
  return tabs.find((tab) => tab.sessionId === sessionId)?.workspaceId ?? null
}

export function registerClaudeLimitGuardHandlers(
  store: Store,
  runtime: OrcaRuntimeService,
  rateLimits: RateLimitService,
  handoffs: Pick<ClaudeHandoffOffers, 'checkStoppedSession'>
): void {
  const activeAccountId = (): string | null =>
    normalizeClaudeRuntimeSelection(store.getSettings()).host
  // Custom build (claude-subscriptions): a stopped chat can continue on another subscription.
  const chats: ClaudeChatLimitContinueDeps = {
    settings: () => store.getSettings(),
    baseConfigDir: () =>
      mainProcessState.claudeAccounts?.getRuntimeConfigDir({ runtime: 'host' }) ?? null,
    getRecord: (sessionId) =>
      getStructuredAgentSessionHost()?.deps.store.getRecord(sessionId) ?? null
  }
  const syncChatBell = (current: ClaudeLimitStoppedAgent[]): void => {
    const authStops = current.filter(claudeLimitStopIsAuth)
    try {
      runtime.pulseSyncInboxKind(
        PULSE_BELL_KIND.claudeChatLimit,
        limitStoppedChatItems(chats, current)
      )
      runtime.pulseSyncInboxKind(
        PULSE_BELL_KIND.claudeAuthStop,
        authStops.length > 0 ? [claudeAuthStopBellItem(authStops)] : []
      )
    } catch (error) {
      console.warn('[claude-limit-guard] chat limit bell sync failed:', error)
    }
  }
  const stops = createClaudeLimitStops({
    now: Date.now,
    activeAccountId,
    resumeTerminal: (paneKey) => resumeTerminal(runtime, paneKey),
    resumeNativeChat,
    nativeChatSubscription: (sessionId) => claudeChatSubscriptionIdOf(chats, sessionId),
    onChanged: (current) => {
      broadcast(current)
      syncChatBell(current)
    },
    checkHandoff: async (stop) => {
      const sessionId = stop.kind === 'native-chat' ? stop.key : stop.sessionId
      // Why: a native chat's tab may have been unknown at the stop and restored since.
      const worktreeId = stop.worktreeId ?? (sessionId ? nativeChatWorktreeId(sessionId) : null)
      return sessionId && worktreeId
        ? handoffs.checkStoppedSession(worktreeId, sessionId, stop.stoppedAt)
        : false
    },
    log: (message) => console.log('[claude-limit-guard]', message)
  })

  agentHookServer.subscribeEnrichedStatus((event) => stops.onHookStatus(event))
  setClaudeNativeFrameListener((sessionId, frame) =>
    stops.onNativeFrame(sessionId, nativeChatWorktreeId(sessionId), frame)
  )

  let lastActive = activeAccountId()
  store.onSettingsChanged((_updates, settings) => {
    const next = normalizeClaudeRuntimeSelection(settings).host
    if (next === lastActive) {
      return
    }
    lastActive = next
    void (async () => {
      await delay(SWITCH_SETTLE_MS)
      await mainProcessState.claudeRuntimeAuth?.syncForCurrentSelection()
      if (activeAccountId() === next) {
        console.log('[claude-limit-guard]', `active account → ${next ?? 'system default'}`)
        await stops.onAccountChanged(next)
      }
    })().catch((error: unknown) => console.warn('[claude-limit-guard] resume failed:', error))
  })

  rateLimits.onStateChange((state) => {
    const accountId = state.claude ? claudeLimitsAccountId(state.claude) : undefined
    // Why: only a reading that names the account it came from may lift that account's stops.
    if (!state.claude || accountId === undefined || accountId !== activeAccountId()) {
      return
    }
    void stops.onActiveUsage(accountId, state.claude)
  })

  ipcMain.handle('claudeLimitGuard:list', () => stops.list())
  ipcMain.handle('claudeLimitGuard:continueAuthStops', async () => {
    // Why: rewrites the CLI sign-in from the selected account, in case it was the stale one.
    await mainProcessState.claudeRuntimeAuth
      ?.syncForCurrentSelection()
      .catch((error: unknown) => console.warn('[claude-limit-guard] re-sync failed:', error))
    const resumed = await stops.resumeAuthStops()
    console.log('[claude-limit-guard]', `continue after sign-in fix: ${resumed} agent(s)`)
    return { resumed }
  })
  // Why: stops live in memory, so items the last run left open are stale.
  syncChatBell([])
  ipcMain.handle(
    'claudeLimitGuard:continueOnSubscription',
    async (_event, args: { sessionId?: unknown; subscriptionId?: unknown }) => {
      const host = getStructuredAgentSessionHost()
      if (!host || typeof args?.sessionId !== 'string' || typeof args.subscriptionId !== 'string') {
        return { ok: false, reason: 'missing' }
      }
      return continueChatOnSubscription(
        {
          ...chats,
          switchAccountHome: host.lifetime.switchAccountHome,
          prepareHome: prepareClaudeSubscriptionHome,
          hasTranscript: async ({ providerSessionId, claudeProjectsDir }) =>
            (await resolveSessionFilePath('claude', providerSessionId, { claudeProjectsDir })) !==
            null,
          forgetStop: (sessionId) => stops.forgetNativeChat(sessionId),
          resume: resumeNativeChat
        },
        args.sessionId,
        args.subscriptionId
      )
    }
  )
}
