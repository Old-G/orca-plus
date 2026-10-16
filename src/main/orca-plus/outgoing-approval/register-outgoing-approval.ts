// Custom build (outgoing-approval): wires the gate into the hook server, the bell and the renderer.
// The gate opens its own connection to orca-plus-pulse.db so approving a draft never joins the runtime
// surface that RPC and the CLI reach.
import { ipcMain } from 'electron'
import { getAppEnvironment } from '../../../shared/app-environment'
import {
  OUTGOING_APPROVAL_BELL_KIND,
  outgoingApprovalBellItem
} from '../../../shared/outgoing-approval/outgoing-approval-bell'
import type { PulseApprovalOutcome, PulseDraft } from '../../../shared/pulse-types'
import { agentHookServer } from '../../agent-hooks/server'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { PulseDb, pulseDbPath } from '../pulse/pulse-db'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { bindOutgoingGateEndpoint } from './outgoing-gate-endpoint'
import { createOutgoingGateRequestHandler } from './outgoing-gate-http'

const SWEEP_INTERVAL_MS = 30_000
const OUTCOMES: readonly PulseApprovalOutcome[] = ['approved', 'edited', 'rejected']

type DecidedListener = (decided: PulseDraft, outcome: PulseApprovalOutcome) => void
const decidedListeners = new Set<DecidedListener>()

/** Custom build (hq-reply-tone): how the owner answered a held call, for HQ to learn from. */
export function onOutgoingApprovalDecided(listener: DecidedListener): () => void {
  decidedListeners.add(listener)
  return () => decidedListeners.delete(listener)
}

export function registerOutgoingApproval(runtime: OrcaRuntimeService): void {
  let db: PulseDb | null = null
  const syncBell = (): void => {
    try {
      runtime.pulseSyncInboxKind(
        OUTGOING_APPROVAL_BELL_KIND,
        gate.pending().map(outgoingApprovalBellItem)
      )
    } catch (error) {
      console.warn('[outgoing-approval] bell sync failed:', error)
    }
  }
  const gate = new OutgoingApprovalGate({
    db: () => (db ??= new PulseDb(pulseDbPath(getAppEnvironment().getPath('userData')))),
    onChanged: syncBell
  })
  agentHookServer.setOutgoingGateHandler(createOutgoingGateRequestHandler(() => gate))
  bindOutgoingGateEndpoint(() => agentHookServer.endpointFilePath)
  const sweep = setInterval(() => {
    try {
      gate.sweepAbandoned()
    } catch (error) {
      console.warn('[outgoing-approval] sweep failed:', error)
    }
  }, SWEEP_INTERVAL_MS)
  sweep.unref?.()
  // Why: cards from the last run come back for calls whose hooks reconnect; the sweep drops the rest.
  syncBell()

  ipcMain.handle(
    'outgoingApproval:decide',
    (_event, id: unknown, outcome: unknown, text: unknown) => {
      const known = OUTCOMES.find((candidate) => candidate === outcome)
      if (typeof id !== 'string' || !known) {
        throw new Error('outgoingApproval:decide needs a draft id and an outcome')
      }
      const decided = gate.decide(id, known, typeof text === 'string' ? text : undefined)
      for (const listener of decidedListeners) {
        try {
          listener(decided, known)
        } catch (error) {
          console.warn('[outgoing-approval] decided listener failed:', error)
        }
      }
    }
  )
}
