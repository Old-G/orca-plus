// Custom build (hq-handoff-auto, owner 24.11): one handoff, one new chat — the chat may be starting its
// own with `orca agent launch` right now, or have started it since the offer was raised.
import { randomUUID } from 'node:crypto'
import { getClaudeHandoffClaims, type ClaudeHandoffClaims } from './claude-handoff-claims'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  prepareAgentCreationCard,
  startedAgentSender
} from '../runtime/orchestration/workers/launch/worker-start-card'
import { ORCA_SESSION_ADDRESS_PREFIX } from '../../shared/agent-session/identity/orca-session-address-prefix'

const NATIVE_CHAT_TAB = 'structured-agent-session-'

type Started =
  | { ok: true; tabId: string | undefined }
  | { ok: false; error: string; skipped?: true }

export async function startClaudeHandoffOnce(args: {
  /** The old chat's Orca session id; null for a terminal chat, which no claim covers. */
  fromSessionId: string | null
  ownStarted: () => Promise<boolean>
  dismiss: () => void
  start: () => Promise<Started>
  /** The «started a chat» card the old chat shows; the old chat's runtime and the new chat's task.
   *  Absent when the old chat closes with the start («Continue in new chat»). */
  card?: { runtime: OrcaRuntimeService; task: string }
  claims?: ClaudeHandoffClaims
}): Promise<Started> {
  const { fromSessionId } = args
  const claims = args.claims ?? getClaudeHandoffClaims()
  if (fromSessionId) {
    // Custom build (hq-handoff-once, owner 27.11): a chat already continues this one — started by the
    // chat itself, a click, the sweep or a queue drain a moment ago. Any second start is a duplicate.
    const successor = claims.successorOf(fromSessionId)
    if (successor) {
      args.dismiss()
      return { ok: false, error: `This chat is already continued in ${successor}.`, skipped: true }
    }
    // Why the offer stays: should the chat's own launch fail, its claim lapses and Orca+ starts it.
    if (!claims.claimForOrca(fromSessionId)) {
      return { ok: false, error: 'A new chat for this handoff is already starting.', skipped: true }
    }
    if (await args.ownStarted()) {
      claims.release(fromSessionId)
      args.dismiss()
      return { ok: false, error: 'The chat already started its new chat itself.', skipped: true }
    }
  }
  // Why: the old chat stays open, so it shows where its work went, as a chat's own launch does.
  const publishCard = args.card
    ? prepareClaudeHandoffCard(args.card.runtime, fromSessionId, args.card.task)
    : null
  let started: Started
  try {
    started = await args.start()
  } catch (error) {
    if (fromSessionId) {
      claims.release(fromSessionId)
    }
    throw error
  }
  if (!started.ok) {
    if (fromSessionId) {
      claims.release(fromSessionId)
    }
    return started
  }
  const toSessionId = started.tabId?.startsWith(NATIVE_CHAT_TAB)
    ? started.tabId.slice(NATIVE_CHAT_TAB.length)
    : null
  if (fromSessionId) {
    claims.started(fromSessionId, toSessionId ?? undefined)
  }
  if (toSessionId) {
    publishCard?.(toSessionId)
  }
  return started
}

/** The «started a chat» card in the old chat, captured before the start. */
function prepareClaudeHandoffCard(
  runtime: OrcaRuntimeService,
  fromSessionId: string | null,
  task: string
): ((toSessionId: string) => void) | null {
  const publish = fromSessionId ? prepareAgentCreationCard(fromSessionId) : null
  return publish
    ? (toSessionId) =>
        publish(() => ({
          kind: 'agent-handoff',
          launchId: randomUUID(),
          agent: startedAgentSender(
            runtime,
            `${ORCA_SESSION_ADDRESS_PREFIX}${toSessionId}`,
            'claude'
          ),
          task
        }))
    : null
}
