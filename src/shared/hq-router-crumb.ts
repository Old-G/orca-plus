// Custom build (hq-router crumbs, owner 26.11): the footer an approved message ends with carries a
// breadcrumb — project › Lead › chat · task · ref · the sending chat's short id — so an answer to it
// can be routed back by code. The id is the chat's own session id cut to 8 characters: it never
// changes, and Orca+ follows it to the chat's successor or Lead when that chat has closed. The parser
// reads the footer however Slack wrapped, quoted or forwarded it, and the older footer without a Lead.
// No runtime imports: the offline eval runs this file as it is.

/** What a footer names. */
export type HqCrumbFooter = {
  ref: string | null
  /** The sending chat's short id (8 hex); absent in the older footer. */
  chatId: string | null
  chatTitle: string | null
  leadTitle: string | null
  project: string | null
  task: string | null
}

/** A crumb resolved against the chats: the live successor of the sender, and its Lead. */
export type HqRouterCrumb = {
  /** The live chat, when it is still open. */
  chat: string | null
  /** Its Lead now, when it has one. */
  lead: string | null
  /** The sender's title, as the footer named it. */
  chatTitle: string | null
}

export const HQ_CRUMB_MARK = '↳'
const ID_LENGTH = 8

/** The short id a footer carries for a chat's session id. */
export function hqCrumbChatId(sessionId: string): string {
  return sessionId
    .replace(/^(claude|codex)_/, '')
    .replace(/[^0-9a-f]/gi, '')
    .slice(0, ID_LENGTH)
    .toLowerCase()
}

/** True when `sessionId` is the chat a footer's short id names. */
export function hqCrumbIdMatches(chatId: string, sessionId: string): boolean {
  return chatId.length === ID_LENGTH && hqCrumbChatId(sessionId) === chatId
}

/** Footer text as Slack and forwarding leave it: no italics, quotes, link markup or line breaks. */
function flatten(text: string): string {
  return (
    text
      .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
      .replace(/^[ \t]*(?:&gt;|>)+[ \t]?/gm, '')
      // Why only at the edges: italics wrap the footer, while names keep their own underscores.
      .replace(/(^|\s)[_*]+|[_*]+(?=\s|$)/gm, '$1')
      .replace(/\s+/g, ' ')
  )
}

const FOOTER = /↳\s?(.{0,400}?)\bref\s([0-9a-z]{6})\b(?:\s?·\s?id\s([0-9a-f]{8})\b)?/gi
const TASK = /\b(DEV-\d{2,7})\b/i

function parseHead(head: string): Omit<HqCrumbFooter, 'ref' | 'chatId'> {
  const quoted = /«([^»]+)»/.exec(head)
  const before = quoted ? head.slice(0, quoted.index) : head
  const after = quoted ? head.slice(quoted.index + quoted[0].length) : ''
  const task = TASK.exec(after)?.[1] ?? TASK.exec(before)?.[1] ?? null
  let project: string | null = null
  let leadTitle: string | null = null
  const chain = before.split('›').map((part) => part.trim())
  if (chain.length >= 2) {
    // `project › Lead › «chat»` (or `project › «chat»`); a task, when first, is cut off the project.
    project =
      chain[0]
        .split('·')
        .map((part) => part.trim())
        .findLast(Boolean) ?? null
    leadTitle = chain.length >= 3 ? chain.slice(1, -1).join(' › ').trim() || null : null
  } else {
    // The older `[DEV-1](url) · project · «chat»`: the project is the last part before the chat.
    project =
      before
        .split('·')
        .map((part) => part.trim())
        .findLast((part) => !!part && !TASK.test(part)) ?? null
  }
  return {
    chatTitle: quoted ? quoted[1].trim() : null,
    leadTitle,
    project,
    task: task ? task.toUpperCase() : null
  }
}

/** Every footer in the text, last one first (a reply quoting ours ends with ours). */
export function parseHqCrumbs(text: string | null | undefined): HqCrumbFooter[] {
  if (!text || !text.includes(HQ_CRUMB_MARK)) {
    return []
  }
  const flat = flatten(text)
  const out: HqCrumbFooter[] = []
  for (const match of flat.matchAll(FOOTER)) {
    out.push({ ...parseHead(match[1]), ref: match[2].toLowerCase(), chatId: match[3] ?? null })
  }
  return out.toReversed()
}

/**
 * The footer line with the crumb: `↳ project › Lead › «chat» · DEV-1 · ref abc123 · id 1a2b3c4d`.
 * Parts that are unknown are left out; the ref always ends up last but one, the id last.
 */
export function hqCrumbFooterParts(parts: {
  project: string | null
  leadTitle: string | null
  chatTitle: string | null
}): string | null {
  const chain = [
    parts.project,
    parts.leadTitle,
    parts.chatTitle ? `«${parts.chatTitle}»` : null
  ].filter((part): part is string => !!part)
  return chain.length > 0 ? chain.join(' › ') : null
}
