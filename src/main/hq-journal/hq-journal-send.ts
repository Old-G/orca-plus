// Custom build (chat-send-anywhere): `orca chat send` — a message into a chat of any room, by its
// thread's `<project>/<task>` or its session id, with the quote of what it answers. A chat in the
// middle of its turn gets it queued for when the turn ends; a closed chat is brought back first.
// A Lead's messages from other chats are held and go in one turn (hq-lead-batch).
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  hqJournalTitle,
  type HqSession
} from '../../shared/hq-journal'
import { journalEntryAsInput } from './hq-journal-adapters'
import type { HqCallerScope } from './hq-journal-rooms'
import type { HqThreads, HqThreadsDeps } from './hq-journal-threads'
import { hqLeadBatchPrompt, hqLeadUrgent, type HqLeadHeld } from './hq-lead-batch'

const SEND_SOURCE = 'chat-send'
const LEAD_BATCH_SOURCE = 'lead-batch'
// Why: a reopened chat takes a moment to attach its session before it can take a turn.
const REOPEN_TRIES = 15
const REOPEN_STEP_MS = 1_000

export const HQ_JOURNAL_OFF = 'The HQ+ journal is off (Settings → Workspace → HQ+ journal).'

export function hqRoomOf(scope: HqCallerScope): string {
  return scope.kind === 'room' ? scope.room : HQ_JOURNAL_ALL_ROOMS
}

function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type HqDeliverDeps = Pick<HqThreadsDeps, 'deliver' | 'reopen' | 'wait' | 'sessionWorkspace'>

/** Hands the chat a prompt, bringing it back once when it is closed. */
async function deliverOrReopen(
  deps: HqDeliverDeps,
  target: { sessionId: string; worktreeId: string | null },
  prompt: string
): Promise<{ taken: boolean; reopened: boolean; worktreeId: string | null }> {
  let reopened = false
  let taken = await deps.deliver(target.sessionId, prompt)
  const worktreeId = target.worktreeId ?? deps.sessionWorkspace(target.sessionId)
  if (!taken && worktreeId && deps.reopen(target.sessionId, worktreeId)) {
    reopened = true
    for (let tries = 0; tries < REOPEN_TRIES && !taken; tries += 1) {
      await deps.wait(REOPEN_STEP_MS)
      taken = await deps.deliver(target.sessionId, prompt)
    }
  }
  return { taken, reopened, worktreeId }
}

type HqLeadPulse = Pick<HqThreadsDeps['pulse'], 'getSession' | 'listSessionsByAddress'>

/** Custom build (hq-lead-batch): the chat on the Lead's thread now — a handoff's new chat takes it over. */
export function hqLeadBatchSession(pulse: HqLeadPulse, held: HqLeadHeld): string {
  return pulse.listSessionsByAddress(held.address)[0]?.sessionId ?? held.sessionId
}

/** Custom build (hq-lead-batch): a held batch goes to the chat on the Lead's thread now. */
export async function hqDeliverLeadBatch(
  deps: HqDeliverDeps & { pulse: HqLeadPulse },
  held: HqLeadHeld,
  prompt: string
): Promise<boolean> {
  const sessionId = hqLeadBatchSession(deps.pulse, held)
  const worktreeId = deps.pulse.getSession(sessionId)?.worktreeId ?? null
  return (await deliverOrReopen(deps, { sessionId, worktreeId }, prompt)).taken
}

/** Custom build (hq-lead-batch): a batch no Lead took becomes the owner's card, with every message. */
export function hqLeadBatchGiveUp(
  deps: { pulse: HqLeadPulse & Pick<HqThreadsDeps['pulse'], 'record'>; now: () => number },
  held: HqLeadHeld,
  prompt: string
): void {
  const sessionId = hqLeadBatchSession(deps.pulse, held)
  const session = deps.pulse.getSession(sessionId)
  deps.pulse.record([
    {
      workspace: session?.workspace ?? HQ_JOURNAL_ALL_ROOMS,
      // Why: a chat.message row is the chats' own talk and stays out of the feed; a report with the
      // owner's move is a card.
      kind: HQ_JOURNAL_KIND.chatReport,
      at: deps.now(),
      project: session?.project ?? 'hq',
      address: held.address,
      sessionId,
      personId: null,
      title: hqJournalTitle(
        `The Lead on ${held.address} took none of ${held.prompts.length} held messages; open it and send them again`
      ),
      body: prompt,
      needs: 'owner:reply',
      status: 'open',
      replyTo: null,
      refKind: 'session',
      refId: sessionId,
      source: LEAD_BATCH_SOURCE,
      dedupeKey: `${LEAD_BATCH_SOURCE}:${held.address}:${held.since}`
    }
  ])
}

export function createHqSend(
  deps: HqThreadsDeps,
  /** The thread a chat works on: its stored address, else one made from its project and name. */
  addressFor: (scope: HqCallerScope, sessionId: string) => string
): HqThreads['send'] {
  const latest = (query: { address: string; source: string }) =>
    deps.pulse.list({ ...query, limit: 1 })[0] ?? null

  const isLead = (sessionId: string): boolean => {
    try {
      return deps.pulse.roleOf?.(sessionId) === 'lead'
    } catch (error) {
      // Why: a role that cannot be read must not stop a send; the message goes as before.
      console.warn('[hq-lead-batch] role lookup failed:', error)
      return false
    }
  }

  /** The chat `to` names: a thread's newest chat, or a session id (a chat with no thread yet too). */
  const locate = async (to: string) => {
    const byId = !to.includes('/')
    // Why: a chat in one long first turn has no address yet; its session id still reaches it.
    const known = byId ? deps.pulse.getSession(to) : null
    const placed = byId && !known?.address ? await deps.scope({ sessionId: to }) : null
    const target: Pick<HqSession, 'sessionId' | 'workspace' | 'project' | 'worktreeId'> | null =
      byId
        ? (known ?? {
            sessionId: to,
            workspace: placed ? hqRoomOf(placed) : HQ_JOURNAL_ALL_ROOMS,
            project: placed?.kind === 'room' ? placed.project : 'hq',
            worktreeId: placed?.worktreeId ?? null
          })
        : (deps.pulse.listSessionsByAddress(to)[0] ?? null)
    if (!target) {
      throw new Error(
        `No chat works on ${to}; \`orca hq sessions --json\` lists the chats — send to its sessionId.`
      )
    }
    // Why: a Lead is named by its thread when it has one, as `orca hq reassign` wrote it.
    return { to, byId, known, placed, target, key: (byId ? known?.address : to) ?? to }
  }

  return async (caller, message) => {
    if (!deps.enabled()) {
      throw new Error(HQ_JOURNAL_OFF)
    }
    const scope = await deps.scope(caller)
    const asked = message.address.trim()
    let spot = await locate(asked)
    // Custom build (hq-lead-reassign): a chat moved to another Lead reaches that Lead when it writes
    // to one it had before — a brief or a plan read before the change still names the old one.
    const callerKey = scope.sessionId
      ? (deps.pulse.getSession(scope.sessionId)?.address ?? scope.sessionId)
      : null
    const movedTo = callerKey ? (deps.pulse.leadMoveOf?.(callerKey, spot.key) ?? null) : null
    if (movedTo) {
      spot = await locate(movedTo)
    }
    // Custom build (hq-handoff-parked, T7 25.11): a chat that handed off is parked — what is sent to it
    // goes to the chat that continues it, the end of its handoff chain. A brief, a plan or a Lead's
    // relay still names the old chat by its session id, and a closed one was even brought back for it.
    const live = deps.pulse.liveSessionOf?.(spot.target.sessionId) ?? spot.target.sessionId
    const successor =
      live !== spot.target.sessionId &&
      live !== scope.sessionId &&
      spot.target.sessionId !== scope.sessionId
    if (successor) {
      spot = await locate(live)
    }
    const { to, byId, known, placed, target } = spot
    const address =
      (byId ? known?.address : to) ??
      addressFor(placed ?? { kind: 'overview', sessionId: to, worktreeId: null }, to)
    const quoted = message.replyTo ? deps.pulse.getEntry(message.replyTo) : null
    if (message.replyTo && !quoted) {
      throw new Error(`No journal entry ${message.replyTo}.`)
    }
    const from =
      (scope.sessionId ? deps.pulse.getSession(scope.sessionId)?.address : null) ??
      // Why: «HQ+» is the owner typing in HQ+; an HQ chat's agent sending is not the owner.
      (scope.kind === 'overview' ? (scope.sessionId ? 'HQ chat' : 'HQ+') : 'another chat')
    const fromRoom =
      scope.kind === 'room' && scope.room !== target.workspace ? ` (room ${scope.room})` : ''
    const head = quoted
      ? `Orca+ · a message from thread ${from}${fromRoom}, in reply to «${quoted.title}» (${stamp(quoted.at)}):`
      : `Orca+ · a message from thread ${from}${fromRoom}:`
    const prompt = [head, '"""', message.text, '"""'].join('\n')
    // Custom build (hq-lead-batch): a Lead takes other chats' messages in one turn; the owner's
    // own message from HQ+ and an urgent report go at once, with what was held.
    const batch = deps.leadBatch && isLead(target.sessionId) ? deps.leadBatch : null
    await batch?.ready
    const ownerTyping = scope.kind === 'overview' && !scope.sessionId
    const hold =
      batch !== null &&
      !ownerTyping &&
      scope.sessionId !== target.sessionId &&
      !hqLeadUrgent(message.text)
    let reopened = false
    let held: { dueAt: number } | undefined
    let worktreeId = target.worktreeId ?? deps.sessionWorkspace(target.sessionId)
    if (batch && hold) {
      held = batch.hold(address, target.sessionId, prompt)
    } else {
      const prior = batch?.take(address) ?? null
      const outgoing = prior ? hqLeadBatchPrompt([...prior.prompts, prompt], prior.since) : prompt
      const sent = await deliverOrReopen(deps, target, outgoing).catch((error: unknown) => {
        if (prior) {
          batch?.restore(prior)
        }
        throw error
      })
      reopened = sent.reopened
      worktreeId = sent.worktreeId
      if (sent.taken && prior) {
        batch?.delivered(prior)
      }
      if (!sent.taken) {
        if (prior) {
          batch?.restore(prior)
        }
        throw new Error(
          byId && !known && !worktreeId
            ? `No open chat ${to}; \`orca hq sessions --json\` lists the chats.`
            : `The chat on ${address} is closed and Orca+ could not bring it back; open it from History and send again.`
        )
      }
    }
    if (byId && !known?.address) {
      // Why: the chat keeps this address; its first report and later messages find the same thread.
      deps.pulse.noteSessions([
        {
          sessionId: target.sessionId,
          address,
          agent: known?.agent ?? null,
          worktreeId,
          workspace: target.workspace,
          project: target.project,
          state: known?.state ?? 'working',
          contextPct: known?.contextPct ?? null,
          parentSessionId: known?.parentSessionId ?? null,
          taskRef: known?.taskRef ?? null,
          at: known?.lastActivityAt ?? deps.now()
        }
      ])
    }
    // Why: the owner's answer is the owner's move; left open, the question still counts as waiting.
    const ownerAnswers =
      quoted !== null &&
      scope.kind === 'overview' &&
      !scope.sessionId &&
      quoted.status === 'open' &&
      quoted.needs.startsWith('owner:') &&
      quoted.dedupeKey !== null
    deps.pulse.record([
      {
        workspace: target.workspace,
        kind: HQ_JOURNAL_KIND.chatMessage,
        at: deps.now(),
        project: target.project,
        address,
        sessionId: target.sessionId,
        personId: null,
        title: hqJournalTitle(`From ${from}: ${message.text}`),
        body: quoted ? `> ${quoted.title}\n\n${message.text}` : message.text,
        needs: `agent:${address}`,
        status: 'done',
        replyTo: quoted?.id ?? null,
        refKind: 'session',
        refId: target.sessionId,
        source: SEND_SOURCE,
        dedupeKey: null
      },
      ...(ownerAnswers ? [journalEntryAsInput(quoted, { status: 'done' })] : [])
    ])
    // Custom build (hq-plus-chat-tree): a chat that hands another chat work is its parent in HQ+'s
    // «By work» tree, unless it already has one; the owner typing in HQ+ is no chat.
    if (scope.sessionId && scope.sessionId !== target.sessionId) {
      deps.pulse.linkChat?.({
        sessionId: target.sessionId,
        parentSessionId: scope.sessionId,
        via: 'send',
        at: deps.now()
      })
    }
    const entry = latest({ address, source: SEND_SOURCE })
    if (!entry) {
      throw new Error('The message was delivered but not recorded.')
    }
    const forwarded = successor
      ? { forwardedFrom: asked, handedOff: true as const }
      : movedTo
        ? { forwardedFrom: asked }
        : {}
    return held
      ? { entry, sessionId: target.sessionId, reopened, heldUntil: held.dueAt, ...forwarded }
      : { entry, sessionId: target.sessionId, reopened, ...forwarded }
  }
}
