// Custom build (outgoing-approval): wires the gate into the hook server, the bell and the renderer.
// The gate opens its own connection to orca-plus-pulse.db so approving a draft never joins the runtime
// surface that RPC and the CLI reach.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { HQ_SLACK_SCOUT_CONFIG_FILE, HQ_SLACK_SCOUT_DIR } from '../../../shared/hq-slack-scout'
import {
  parseOwnerPreviewProjects,
  setOwnerPreviewProjects
} from '../../../shared/outgoing-approval/outgoing-owner-telegram-rules'
import { PulseDb, pulseDbPath } from '../pulse/pulse-db'
import {
  NO_OUTGOING_APPROVAL_OPTIONS,
  readOutgoingApprovalChoice,
  type OutgoingApprovalChoice,
  type OutgoingApprovalOptions
} from '../../../shared/outgoing-approval/outgoing-approval-options'
import { describeOutgoingDraft, type OutgoingContextSources } from './outgoing-approval-context'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { bindOutgoingGateEndpoint } from './outgoing-gate-endpoint'
import { createOutgoingGateRequestHandler } from './outgoing-gate-http'
import { backfillLegacySentContext } from './outgoing-sent-history'
import { slackConversationName } from './outgoing-slack-names'
import { clickUpTaskRef, lastChatTask } from './outgoing-task-sources'
import {
  decideOutgoingCall,
  outgoingApprovalOptions,
  type OutgoingDecideDeps
} from './outgoing-approval-decide'
import { MovedApprovals } from './outgoing-moved-approvals'
import { untaggedClickUpNudge } from './outgoing-untagged-nudge'

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
const OWNER_PREVIEW_REFRESH_MS = 60_000

function refreshOwnerPreviewProjects(): void {
  const root = hqPath()
  let config = ''
  try {
    config = root
      ? readFileSync(join(root, HQ_SLACK_SCOUT_DIR, HQ_SLACK_SCOUT_CONFIG_FILE), 'utf8')
      : ''
  } catch {
    // No HQ config: no project previews pass without a card.
  }
  setOwnerPreviewProjects(parseOwnerPreviewProjects(config))
}

export function bindOutgoingApprovalHqPath(read: () => string | null): void {
  hqPath = read
  refreshOwnerPreviewProjects()
  setInterval(refreshOwnerPreviewProjects, OWNER_PREVIEW_REFRESH_MS).unref?.()
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
  const moved = new MovedApprovals()
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
            // Custom build (outgoing-venue): the text the owner moved here was approved already.
            const fulfils = moved.take(draft)
            if (fulfils) {
              decide(draft.id, 'approved', undefined, { footer: fulfils.footer })
            }
          }
        }
      })
      .catch((error: unknown) => console.warn('[outgoing-approval] naming failed:', error))
      .then(syncBell)
  }
  const gate = new OutgoingApprovalGate({
    db: pulseDb,
    onChanged: describeThenSync,
    nudge: untaggedClickUpNudge(() => pulseDb().listPeople())
  })
  const decideDeps: OutgoingDecideDeps = {
    gate,
    context: (id) => contexts.get(id),
    workspaceOf,
    moved,
    decisions: (limit) => pulseDb().listDecisions({ kind: 'approval', limit }),
    waitings: () => pulseDb().listWaitings()
  }
  function decide(
    id: string,
    outcome: PulseApprovalOutcome,
    text: string | undefined,
    choice: OutgoingApprovalChoice
  ): void {
    const { decided, outcome: recorded } = decideOutgoingCall(decideDeps, id, outcome, text, choice)
    for (const listener of decidedListeners) {
      try {
        listener(decided, recorded)
      } catch (error) {
        console.warn('[outgoing-approval] decided listener failed:', error)
      }
    }
  }
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

  // Custom build (outgoing-footer, outgoing-venue): what the card offers beside Approve.
  ipcMain.handle(
    'outgoingApproval:options',
    async (_event, id: unknown): Promise<OutgoingApprovalOptions> => {
      const draft = typeof id === 'string' ? gate.pending().find((held) => held.id === id) : null
      return draft
        ? outgoingApprovalOptions(draft, await contextOf(draft), decideDeps)
        : NO_OUTGOING_APPROVAL_OPTIONS
    }
  )

  ipcMain.handle(
    'outgoingApproval:decide',
    (_event, id: unknown, outcome: unknown, text: unknown, choice: unknown) => {
      const known = OUTCOMES.find((candidate) => candidate === outcome)
      if (typeof id !== 'string' || !known) {
        throw new Error('outgoingApproval:decide needs a draft id and an outcome')
      }
      decide(
        id,
        known,
        typeof text === 'string' ? text : undefined,
        readOutgoingApprovalChoice(choice)
      )
    }
  )
}
