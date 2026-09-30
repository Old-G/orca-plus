// Custom build (pulse-bell): the bell's IPC, its live refresh, and the producers main owns
// (handoff offers, agents waiting on the user). The bell is the pulse database's first reader
// that everyone sees, so from here on it creates the file.
import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
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
import { bindAgentFinishedInbox, clearAgentFinished } from './pulse-bell-agent-finished'
import { createWaitingAgentsTracker } from './pulse-bell-waiting-agents'
import { readPulseBellInputs } from './pulse-bell-input-validation'

const BROADCAST_DEBOUNCE_MS = 50

function broadcastChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('pulseBell:changed')
    }
  }
}

export function registerPulseBell(store: Store, runtime: OrcaRuntimeService): void {
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
