// Custom build (hq-ledger-feed): what `hq.feed` carries from the ledger for HQ+'s feed — the window's
// conversations with their last messages and which conversation each waiting lives in — and the
// conversation as plain lines for the phone and search.

export type HqFeedMessage = {
  direction: 'in' | 'out'
  author: string | null
  text: string
  link: string | null
  at: number
}

export type HqFeedConversation = {
  id: string
  key: string
  project: string | null
  /** How the project was found: `owner`, `rule`, `reply`, `named`, `model` (a guess). */
  projectHow: string | null
  title: string
  state: string
  lastAt: number
  sessionId: string | null
  /** The newest messages, oldest first. */
  messages: HqFeedMessage[]
}

/** What `hq.feed` adds from the ledger. */
export type HqFeedLedger = {
  conversations: HqFeedConversation[]
  /** Waiting id → the key of the conversation it lives in. */
  waitingPlaces: Record<string, string>
}

const LINE_MAX = 300

/** The conversation as plain lines, «You: …» for the owner's own. */
export function hqPlusTranscript(messages: readonly HqFeedMessage[]): string {
  return messages
    .map((message) => {
      const who = message.direction === 'out' ? 'You' : (message.author ?? 'Someone')
      const said = message.text.replace(/\s+/g, ' ').trim()
      const text = said.startsWith(`${who}:`) ? said.slice(who.length + 1).trim() : said
      return `${who}: ${text.length > LINE_MAX ? `${text.slice(0, LINE_MAX - 1)}…` : text}`
    })
    .join('\n')
}

/** The ledger part of an `hq.feed` result, or null when the host sent none or something else. */
export function readHqFeedLedger(value: unknown): HqFeedLedger | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const conversations: unknown = Reflect.get(value, 'conversations')
  const places: unknown = Reflect.get(value, 'waitingPlaces')
  return Array.isArray(conversations) && places && typeof places === 'object'
    ? {
        conversations: conversations.filter(
          (row): row is HqFeedConversation =>
            row && typeof row.key === 'string' && Array.isArray(row.messages)
        ),
        waitingPlaces: Object.fromEntries(
          Object.entries(places).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      }
    : null
}
