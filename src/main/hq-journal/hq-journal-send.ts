// Custom build (chat-send-anywhere): `orca chat send` — a message into a chat of any room, by its
// thread's `<project>/<task>` or its session id, with the quote of what it answers. A chat in the
// middle of its turn gets it queued for when the turn ends; a closed chat is brought back first.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  hqJournalTitle,
  type HqSession
} from '../../shared/hq-journal'
import { journalEntryAsInput } from './hq-journal-adapters'
import type { HqCallerScope } from './hq-journal-rooms'
import type { HqThreads, HqThreadsDeps } from './hq-journal-threads'

const SEND_SOURCE = 'chat-send'
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

export function createHqSend(
  deps: HqThreadsDeps,
  /** The thread a chat works on: its stored address, else one made from its project and name. */
  addressFor: (scope: HqCallerScope, sessionId: string) => string
): HqThreads['send'] {
  const latest = (query: { address: string; source: string }) =>
    deps.pulse.list({ ...query, limit: 1 })[0] ?? null

  return async (caller, message) => {
    if (!deps.enabled()) {
      throw new Error(HQ_JOURNAL_OFF)
    }
    const scope = await deps.scope(caller)
    const to = message.address.trim()
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
    if (!taken) {
      throw new Error(
        byId && !known && !worktreeId
          ? `No open chat ${to}; \`orca hq sessions --json\` lists the chats.`
          : `The chat on ${address} is closed and Orca+ could not bring it back; open it from History and send again.`
      )
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
    return { entry, sessionId: target.sessionId, reopened }
  }
}
