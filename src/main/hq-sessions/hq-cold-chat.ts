// Custom build (hq-cold-handoff, L3 28.11, L1 measure №3): a message to a chat that sat quiet over an hour
// with a full context does not wake it — its next turn would re-read the whole context at full price —
// a new chat on the same thread starts from its last report and takes the message. Off by default.
import { isHqThreadAddress } from '../../shared/hq-journal'
import {
  HQ_COLD_CHAT_MIN_TOKENS,
  HQ_COLD_CHAT_QUIET_MS,
  type HqLiveSession
} from '../../shared/hq-sessions'
import { hqOwnerIn } from './hq-session-decide'

export type HqColdChatInput = {
  /** The chat the message is for, as the dispatcher sees it now; undefined when it does not. */
  session: HqLiveSession | undefined
  /** Context tokens in use; null when unknown — then the message is delivered as before. */
  tokens: number | null
  /** The chat that sends; null for the owner in HQ+ or the CLI. */
  from: string | null
  now: number
}

export type HqColdChatVerdict = { cold: true; why: string } | { cold: false; why: string }

export function decideHqColdChat(input: HqColdChatInput): HqColdChatVerdict {
  const { session, tokens, now } = input
  const warm = (why: string): HqColdChatVerdict => ({ cold: false, why })
  if (!session) {
    return warm('the chat is not known')
  }
  if (!session.address || !isHqThreadAddress(session.address)) {
    return warm('it has no thread a new chat could take over')
  }
  if (session.midTurn || session.state === 'working') {
    return warm('its turn has not ended')
  }
  // Why: a Lead takes other chats' messages in batches; its plan and team live in its context.
  if (session.role === 'lead') {
    return warm('it is a Lead')
  }
  if (input.from === session.sessionId) {
    return warm('it writes to itself')
  }
  if (session.onScreen || hqOwnerIn(session, now)) {
    return warm('the owner is in it')
  }
  const quiet = now - session.lastActivityAt
  if (quiet < HQ_COLD_CHAT_QUIET_MS) {
    return warm('it was active within the hour')
  }
  if (tokens === null) {
    return warm('its context is not known')
  }
  if (tokens < HQ_COLD_CHAT_MIN_TOKENS) {
    return warm('its context is small')
  }
  return {
    cold: true,
    why: `quiet ${Math.round(quiet / 60_000)} min with ${Math.round(tokens / 1000)}k tokens of context`
  }
}
