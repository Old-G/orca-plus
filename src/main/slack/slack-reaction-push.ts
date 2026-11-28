// Custom build (hq-router v2 T7): a reaction Slack pushed down the Socket Mode connection. The app
// subscribes to reaction_added on behalf of the owner (his user token), so his 👾 reaches Orca+ in
// about a second instead of at the next half-minute poll. Listeners decide what a reaction means.

export type SlackReactionPush = {
  /** Who reacted. */
  user: string
  /** Emoji name without colons; a skin tone suffix (`::skin-tone-2`) is cut off. */
  reaction: string
  channel: string
  /** The reacted message's ts. */
  ts: string
  /** When Slack saw the reaction, ms; null when the event did not say. */
  at: number | null
}

type Listener = (push: SlackReactionPush) => void

const listeners = new Set<Listener>()

/** Reads a `reaction_added` event; null for anything else (a file, a removed reaction, junk). */
export function slackReactionPushOf(event: Record<string, unknown>): SlackReactionPush | null {
  if (event.type !== 'reaction_added') {
    return null
  }
  const item =
    event.item && typeof event.item === 'object' ? (event.item as Record<string, unknown>) : {}
  const user = typeof event.user === 'string' ? event.user : null
  const reaction = typeof event.reaction === 'string' ? event.reaction.split('::')[0] : null
  const channel = typeof item.channel === 'string' ? item.channel : null
  const ts = typeof item.ts === 'string' ? item.ts : null
  if (item.type !== 'message' || !user || !reaction || !channel || !ts) {
    return null
  }
  const seconds = Number(event.event_ts)
  return {
    user,
    reaction,
    channel,
    ts,
    at: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
  }
}

export function onSlackReactionPush(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitSlackReactionPush(push: SlackReactionPush): void {
  for (const listener of listeners) {
    try {
      listener(push)
    } catch (error) {
      console.warn('[slack] reaction listener failed', error)
    }
  }
}
