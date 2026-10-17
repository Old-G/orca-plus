// Custom build (outgoing-approval): wires the gate into the hook server, the bell and the renderer.
// The gate opens its own connection to orca-plus-pulse.db so approving a draft never joins the runtime
// surface that RPC and the CLI reach.
import { ipcMain } from 'electron'
import { getAppEnvironment } from '../../../shared/app-environment'
import {
  OUTGOING_APPROVAL_BELL_KIND,
  outgoingApprovalBellItem,
  type OutgoingApprovalContext
} from '../../../shared/outgoing-approval/outgoing-approval-bell'
import type { PulseApprovalOutcome, PulseDraft } from '../../../shared/pulse-types'
import { agentHookServer } from '../../agent-hooks/server'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { readHqSlackScoutIndex } from '../../hq-today/hq-slack-scout-index'
import { PulseDb, pulseDbPath } from '../pulse/pulse-db'
import { outgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import { outgoingFooterFor } from '../../../shared/outgoing-approval/outgoing-footer'
import {
  readOutgoingApprovalChoice,
  type OutgoingApprovalOptions
} from '../../../shared/outgoing-approval/outgoing-approval-options'
import { describeOutgoingDraft, type OutgoingContextSources } from './outgoing-approval-context'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { bindOutgoingGateEndpoint } from './outgoing-gate-endpoint'
import { createOutgoingGateRequestHandler } from './outgoing-gate-http'
import { backfillLegacySentContext } from './outgoing-sent-history'
import { slackConversationName } from './outgoing-slack-names'
import { clickUpTaskRef, lastChatTask } from './outgoing-task-sources'

const SWEEP_INTERVAL_MS = 30_000
// Why: the card waits this long for names at most; the agent is held either way.
const DESCRIBE_TIMEOUT_MS = 3_000
// Why: Slack and the chat records are up by then, so older approvals can be named.
const BACKFILL_DELAY_MS = 30_000
const BACKFILL_DECISIONS = 100
const OUTCOMES: readonly PulseApprovalOutcome[] = ['approved', 'edited', 'rejected']

type DecidedListener = (decided: PulseDraft, outcome: PulseApprovalOutcome) => void
const decidedListeners = new Set<DecidedListener>()

let hqPath: () => string | null = () => null

/** Custom build (outgoing-approval-target): where the Slack scout's files are, for naming DMs. */
export function bindOutgoingApprovalHqPath(read: () => string | null): void {
  hqPath = read
}

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), DESCRIBE_TIMEOUT_MS)
      timer.unref?.()
    })
  ])
}

/** Custom build (hq-reply-tone): how the owner answered a held call, for HQ to learn from. */
export function onOutgoingApprovalDecided(listener: DecidedListener): () => void {
  decidedListeners.add(listener)
  return () => decidedListeners.delete(listener)
}

export function registerOutgoingApproval(runtime: OrcaRuntimeService): void {
  let db: PulseDb | null = null
  const pulseDb = (): PulseDb =>
    (db ??= new PulseDb(pulseDbPath(getAppEnvironment().getPath('userData'))))
  const workspaceOf = (agentSessionId: string): string | null =>
    runtime.openedAgentSessionRecordStore()?.getRecord(agentSessionId)?.location.workspaceId ?? null
  const contexts = new Map<string, OutgoingApprovalContext>()
  const sources: OutgoingContextSources = {
    slackName: (id) => slackConversationName(id),
    scout: async () => {
      const path = hqPath()
      return path ? readHqSlackScoutIndex(path) : null
    },
    chatName: (id) =>
      runtime.openedAgentSessionRecordStore()?.getRecord(id)?.conversationName ?? null,
    lastTask: (id) => lastChatTask(pulseDb(), id),
    clickUpTask: clickUpTaskRef
  }
  // Why: a card restored after a restart was never named in this run.
  const contextOf = async (draft: PulseDraft): Promise<OutgoingApprovalContext> => {
    const kept = contexts.get(draft.id)
    if (kept) {
      return kept
    }
    const named = await withTimeout(describeOutgoingDraft(draft, sources), {})
    contexts.set(draft.id, named)
    return named
  }
  const syncBell = (): void => {
    try {
      const pending = gate.pending()
      runtime.pulseSyncInboxKind(
        OUTGOING_APPROVAL_BELL_KIND,
        pending.map((draft) => outgoingApprovalBellItem(draft, contexts.get(draft.id)))
      )
      const live = new Set(pending.map((draft) => draft.id))
      for (const id of contexts.keys()) {
        if (!live.has(id)) {
          contexts.delete(id)
        }
      }
    } catch (error) {
      console.warn('[outgoing-approval] bell sync failed:', error)
    }
  }
  // Why: a card is raised once and never rewritten, so a new call is named before its card appears.
  let describing = Promise.resolve()
  const describeThenSync = (): void => {
    describing = describing
      .then(async () => {
        for (const draft of gate.pending()) {
          if (!contexts.has(draft.id)) {
            contexts.set(draft.id, await withTimeout(describeOutgoingDraft(draft, sources), {}))
          }
        }
      })
      .catch((error: unknown) => console.warn('[outgoing-approval] naming failed:', error))
      .then(syncBell)
  }
  const gate = new OutgoingApprovalGate({
    db: pulseDb,
    onChanged: describeThenSync
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
  // Custom build (hq-sent-history): approvals whose card showed a bare id get named once.
  const backfill = setTimeout(() => {
    const pulse = pulseDb()
    backfillLegacySentContext(
      pulse.listDecisions({ kind: 'approval', limit: BACKFILL_DECISIONS }),
      {
        getDraft: (id) => pulse.getDraft(id),
        approvalCards: (since) =>
          pulse.listInbox({ includeDone: true, kind: OUTGOING_APPROVAL_BELL_KIND, since }),
        describe: (draft) => withTimeout(describeOutgoingDraft(draft, sources), {}),
        workspaceOf,
        save: (id, context) => pulse.setDecisionContext(id, context)
      }
    ).catch((error: unknown) => console.warn('[outgoing-approval] history naming failed:', error))
  }, BACKFILL_DELAY_MS)
  backfill.unref?.()

  // Custom build (outgoing-footer): what the card offers beside Approve — the footer it adds.
  ipcMain.handle(
    'outgoingApproval:options',
    async (_event, id: unknown): Promise<OutgoingApprovalOptions> => {
      const draft = typeof id === 'string' ? gate.pending().find((held) => held.id === id) : null
      if (!draft) {
        return { footer: null }
      }
      return { footer: outgoingFooterFor(draft, await contextOf(draft)) }
    }
  )

  ipcMain.handle(
    'outgoingApproval:decide',
    (_event, id: unknown, outcome: unknown, text: unknown, choice: unknown) => {
      const known = OUTCOMES.find((candidate) => candidate === outcome)
      if (typeof id !== 'string' || !known) {
        throw new Error('outgoingApproval:decide needs a draft id and an outcome')
      }
      const draft = gate.pending().find((held) => held.id === id)
      const context = contexts.get(id)
      // Why: the footer goes unless the owner unticked it.
      const footer =
        draft && readOutgoingApprovalChoice(choice).footer !== false
          ? outgoingFooterFor(draft, context)
          : null
      // Custom build (hq-sent-history): the history keeps what the card showed and the chat that sent it.
      const decided = gate.decide(
        id,
        known,
        typeof text === 'string' ? text : undefined,
        (held) =>
          outgoingSentContext(held, context, {
            worktreeId: held.call?.agentSessionId ? workspaceOf(held.call.agentSessionId) : null,
            footer
          }),
        { footer }
      )
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
