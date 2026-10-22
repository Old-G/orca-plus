// Custom build (hq-mail-intake): a Gmail API message (`format=full`) as the plain mail HQ parses.
import type { HqMail } from '../../shared/hq-mail-events'

type Part = { mimeType: string; data: string | null; parts: Part[]; headers: Map<string, string> }

function readPart(value: unknown): Part {
  const record = value && typeof value === 'object' ? value : {}
  const body: unknown = Reflect.get(record, 'body')
  const data: unknown = body && typeof body === 'object' ? Reflect.get(body, 'data') : null
  const parts: unknown = Reflect.get(record, 'parts')
  const headers: unknown = Reflect.get(record, 'headers')
  const mimeType: unknown = Reflect.get(record, 'mimeType')
  return {
    mimeType: typeof mimeType === 'string' ? mimeType.toLowerCase() : '',
    data: typeof data === 'string' ? data : null,
    parts: Array.isArray(parts) ? parts.map(readPart) : [],
    headers: new Map(
      (Array.isArray(headers) ? headers : []).flatMap((header: unknown): [string, string][] => {
        const name: unknown =
          header && typeof header === 'object' ? Reflect.get(header, 'name') : null
        const text: unknown =
          header && typeof header === 'object' ? Reflect.get(header, 'value') : null
        return typeof name === 'string' && typeof text === 'string'
          ? [[name.toLowerCase(), text]]
          : []
      })
    )
  }
}

function findPart(part: Part, mimeType: string): Part | null {
  if (part.mimeType === mimeType && part.data) {
    return part
  }
  for (const child of part.parts) {
    const found = findPart(child, mimeType)
    if (found) {
      return found
    }
  }
  return null
}

function decode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' '
}

/** HTML as lines of text, its links and id markers kept after the text — they carry the task ids. */
export function gmailHtmlToText(html: string): string {
  // Why: ClickUp marks its emails with `title="task_id_start-…-task_id_end"`; those ids are exact.
  const links = [...html.matchAll(/(?:href|title)\s*=\s*"([^"]+)"/gi)]
    .map((match) => match[1] ?? '')
    .filter((value) => /^https?:|_id_start-/.test(value))
  const text = html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return [text, ...links.map((link) => link.replace(/&amp;/g, '&'))].join('\n')
}

export function gmailMessageToMail(message: unknown): HqMail | null {
  const record = message && typeof message === 'object' ? message : null
  const id: unknown = record ? Reflect.get(record, 'id') : null
  const internalDate: unknown = record ? Reflect.get(record, 'internalDate') : null
  if (!record || typeof id !== 'string') {
    return null
  }
  const payload = readPart(Reflect.get(record, 'payload'))
  const plain = findPart(payload, 'text/plain')
  const html = findPart(payload, 'text/html')
  const body = plain?.data
    ? decode(plain.data)
    : html?.data
      ? gmailHtmlToText(decode(html.data))
      : ''
  return {
    id,
    from: payload.headers.get('from') ?? '',
    subject: payload.headers.get('subject') ?? '',
    // Why: ClickUp's plain part drops the links; its HTML is read whenever there is one.
    body: plain && html?.data ? `${body}\n${gmailHtmlToText(decode(html.data))}` : body,
    receivedAt: Number(internalDate) || 0
  }
}
