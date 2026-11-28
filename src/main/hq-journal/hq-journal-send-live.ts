// Custom build (chat-send-live, A2 28.11): `orca chat send` hands a message to a chat that is open, not
// to whichever chat last held the address. A closed chat is brought back only on --revive, and an address
// with two open chats takes a session id instead — a guess sent a «stop» and reports to the wrong chat
// and woke closed ones into duplicate workers (U1 audit, rakes samantha-lead).
import type { HqSession } from '../../shared/hq-journal'
import { HQ_SEND_TO_LEAD, type HqLeadResult } from '../../shared/hq-lead-of'
import type { HqLeadOfAsk } from './hq-lead-of'

/** What `orca chat send` does with a closed chat: `revive` brings it back (HQ+, the phone, the
 *  dispatcher); `refuse` says so and sends nothing (the CLI without --revive). */
export type HqSendOnClosed = 'revive' | 'refuse'

export type HqSendLiveDeps = {
  getSession: (sessionId: string) => HqSession | null
  liveSessionOf?: (sessionId: string) => string
  /** The chats with a tab open; null when they could not be read (then nothing is refused). */
  openTabs?: () => ReadonlySet<string> | null
}

const LIST_MAX = 5

function short(sessionId: string): string {
  return sessionId.slice(0, 8)
}

/** The chats on `address`, each followed to the chat that continues it, newest first, once each. */
function chainEnds(deps: HqSendLiveDeps, sessions: readonly HqSession[]): string[] {
  return [...new Set(sessions.map((s) => deps.liveSessionOf?.(s.sessionId) ?? s.sessionId))]
}

/** The open chats of a project, as `address (sessionId)`, for the hint of a refused send. */
function openOfProject(
  deps: HqSendLiveDeps,
  open: ReadonlySet<string>,
  project: string | null
): string[] {
  if (!project) {
    return []
  }
  return [...open]
    .map((sessionId) => deps.getSession(sessionId))
    .filter((session): session is HqSession => session?.project === project)
    .slice(0, LIST_MAX)
    .map((session) => `${session.address ?? '(no address)'} (${session.sessionId})`)
}

/**
 * The chat on `address` that takes the message: its one open chat, else its newest (closed or with
 * the tabs unknown — brought back as before). Throws for `refuse` when two are open.
 */
export function hqPickOnAddress(
  deps: HqSendLiveDeps,
  address: string,
  sessions: readonly HqSession[],
  onClosed: HqSendOnClosed
): HqSession | null {
  const open = deps.openTabs?.() ?? null
  if (!open || sessions.length === 0) {
    return sessions[0] ?? null
  }
  const live = chainEnds(deps, sessions).filter((sessionId) => open.has(sessionId))
  if (live.length === 1) {
    return deps.getSession(live[0]) ?? sessions.find((s) => s.sessionId === live[0]) ?? null
  }
  if (live.length > 1 && onClosed === 'refuse') {
    throw new Error(
      `${live.length} chats are open on ${address}: ${live
        .slice(0, LIST_MAX)
        .map((sessionId) => {
          const state = deps.getSession(sessionId)?.state
          return state ? `${sessionId} (${state})` : sessionId
        })
        .join(', ')}. Not sent: send to one by its sessionId (\`orca chat send <sessionId> "…"\`).`
    )
  }
  return sessions[0]
}

/** Throws when `onClosed` is `refuse` and the chat that would take the message is closed. */
export function hqRefuseClosed(
  deps: HqSendLiveDeps,
  target: { sessionId: string; project: string | null },
  shown: string,
  onClosed: HqSendOnClosed,
  notDelivered: (message: string) => Error
): void {
  const open = deps.openTabs?.() ?? null
  if (onClosed !== 'refuse' || !open || open.has(target.sessionId)) {
    return
  }
  const others = openOfProject(deps, open, target.project)
  throw notDelivered(
    [
      `The chat on ${shown} (${short(target.sessionId)}) is closed. Not sent.`,
      others.length > 0
        ? `Open chats of ${target.project}: ${others.join(', ')}.`
        : `No chat of ${target.project ?? 'that project'} is open.`,
      `Bring it back with \`orca chat send ${shown} --revive "…"\`, or start a new chat from its brief (\`orca agent launch\`).`
    ].join(' ')
  )
}

/** Custom build (hq-lead-of, A1): `lead` is the Lead of the sender's plan; any other address as given. */
export async function hqSendAddress(
  asked: string,
  sessionId: string | null,
  leadOf: ((ask: HqLeadOfAsk) => Promise<HqLeadResult>) | undefined
): Promise<string> {
  if (asked.toLowerCase() !== HQ_SEND_TO_LEAD) {
    return asked
  }
  if (!leadOf) {
    throw new Error('Finding the Lead is not available on this host; send to its sessionId.')
  }
  return (await leadOf({ sessionId })).sessionId
}

/** Why a chat did not take the message, when Orca+ tried it. */
export function hqNotTakenText(address: string, onClosed: HqSendOnClosed): string {
  return onClosed === 'refuse'
    ? `The chat on ${address} did not take the message: it is closed or still starting. Not sent. Send again in a moment; a closed one comes back with \`orca chat send ${address} --revive "…"\`, or start a new chat from its brief.`
    : `The chat on ${address} is closed and Orca+ could not bring it back; open it from History and send again.`
}
