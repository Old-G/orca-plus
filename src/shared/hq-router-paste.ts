// Custom build (hq-router T4, owner 26.11): what the owner pasted into «👾 Router» — every Slack message
// link is one card, the rest of the text (if any is left) one more. One model call per card, no memory.
import { HQ_INTAKE_TEXT_MAX } from './hq-slack-intake'

const SLACK_MESSAGE_LINK =
  /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d{16}[^\s<>"')]*/gi

export type HqRouterPaste = { links: string[]; text: string | null }

/** The Slack message links in the paste, each once and in order, and the words left around them. */
export function hqRouterPasteParts(input: string): HqRouterPaste {
  const links = [...new Set(input.match(SLACK_MESSAGE_LINK) ?? [])]
  const rest = input
    .replace(SLACK_MESSAGE_LINK, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // Why a few letters at least: «и» or a bullet left between two links is no message.
  const text = rest.replace(/[^\p{L}\p{N}]+/gu, '').length >= 3 ? rest : null
  return { links, text: text ? text.slice(0, HQ_INTAKE_TEXT_MAX) : null }
}

// Why no \b: in JS it knows only Latin letters, so «написал» never ends a word.
const SAID =
  /^\s*([\p{Lu}][\p{L}-]{1,30}(?:\s[\p{Lu}][\p{L}-]{1,30})?)\s+(?:написал[аи]?|пишет|ответил[аи]?|говорит|спрашивает|просит|wrote|says|asks|replied)(?=[\s:,—-]|$)\s*[:,—-]?\s*/u

/** Who said it, when the text opens with «Name wrote: …»; null when it does not say. */
export function hqRouterPasteAuthor(text: string): string | null {
  return SAID.exec(text)?.[1] ?? null
}
