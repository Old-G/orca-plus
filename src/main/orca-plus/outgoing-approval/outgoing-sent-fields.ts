// Custom build (hq-request-ledger): reading a finished tool call's input and result — MCP results come
// as text blocks holding JSON (sometimes JSON inside a JSON string), Bash as `{stdout, stderr}`.

export type OutgoingSentMessage = {
  key: string
  /** The source's own id of the message. */
  ts: string
  /** When the source dates it (a Slack ts); null leaves it to the time it was read. */
  at: number | null
  text: string
  link: string | null
  title: string
}

/** The repo (`group/name`) a folder's git remote names; null when it names none. */
export type RepoOfCwd = (cwd: string) => Promise<string | null>

const TITLE_MAX = 100
// Why: the footer Approve adds says where the message came from, not what was said.
const FOOTER = /\n+_?↳ [^\n]*\bref [0-9a-z]{6}_?\s*$/

export function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

export function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** A positive integer id, from a number or its digits. */
export function num(value: unknown): string | null {
  const text = str(value)
  return text && /^\d+$/.test(text) && text !== '0' ? text : null
}

/** The first of `keys` the input has as text; the text as written, not trimmed. */
export function inputText(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return null
}

/** The text of a result: a string, MCP text blocks, `{content: [...]}`, or Bash's stdout. */
export function responseText(response: unknown): string {
  if (typeof response === 'string') {
    return response
  }
  const blocks = Array.isArray(response) ? response : field(response, 'content')
  if (Array.isArray(blocks)) {
    return blocks
      .map((block) => (field(block, 'type') === 'text' ? String(field(block, 'text') ?? '') : ''))
      .join('\n')
  }
  const stdout = field(response, 'stdout')
  return typeof stdout === 'string' ? stdout : ''
}

/** JSON read from text, unwrapping a JSON string that holds JSON; null when it is not JSON. */
export function parseJsonText(text: string): unknown {
  let value: unknown = text
  for (let depth = 0; depth < 2 && typeof value === 'string'; depth += 1) {
    const trimmed = value.trim()
    if (!/^[[{"]/.test(trimmed)) {
      return depth === 0 ? null : value
    }
    try {
      value = JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  return value
}

export function sentText(text: string): string {
  return text.replace(FOOTER, '').trim()
}

export function sentTitle(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line || '(no text)'
}

export function sentMessage(
  key: string,
  ts: string,
  raw: string | null,
  extra: { at?: number | null; link?: string | null; title?: string | null } = {}
): OutgoingSentMessage {
  const text = sentText(raw ?? '')
  return {
    key,
    ts,
    at: extra.at ?? null,
    text,
    link: extra.link ?? null,
    title: extra.title?.trim() || sentTitle(text)
  }
}
