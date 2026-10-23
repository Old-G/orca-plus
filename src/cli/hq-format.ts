// Custom build (hq-plus-journal): plain-text views for `orca hq`, short enough for a model's context.
import type {
  HqEventsResult,
  HqJournalEntry,
  HqJournalHeader,
  HqWhoami
} from '../shared/hq-journal'

const BODY_PREVIEW = 160

function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function line(entry: HqJournalHeader, withRoom: boolean): string {
  return [
    stamp(entry.at),
    withRoom ? `[${entry.workspace}]` : null,
    entry.kind,
    entry.status === 'open' ? entry.needs : `${entry.needs} (${entry.status})`,
    entry.project ? `· ${entry.project}` : null,
    `— ${entry.title}`,
    ` ${entry.id}`
  ]
    .filter((part): part is string => part !== null)
    .join(' ')
}

function preview(entry: HqJournalEntry): string | null {
  const body = entry.body?.replace(/\s+/g, ' ').trim()
  if (!body || entry.title.includes(body.slice(0, 40))) {
    return null
  }
  return `    ${body.length > BODY_PREVIEW ? `${body.slice(0, BODY_PREVIEW - 1)}…` : body}`
}

export function formatHqEvents(result: HqEventsResult): string {
  if (result.scope === 'overview') {
    const head = `HQ+ overview — headings of every room (${result.headers.length}). Full entries: --room <slug>.`
    return result.headers.length === 0
      ? `${head}\nNo events.`
      : [head, ...result.headers.map((entry) => line(entry, true))].join('\n')
  }
  const name = result.roomName ? ` (${result.roomName})` : ''
  const head = `Room ${result.room}${name} — ${result.entries.length} event(s).`
  if (result.entries.length === 0) {
    return `${head}\nNo events.`
  }
  return [
    head,
    ...result.entries.flatMap((entry) =>
      [line(entry, false), preview(entry)].filter((part): part is string => part !== null)
    )
  ].join('\n')
}

export function formatHqWhoami(whoami: HqWhoami): string {
  const room = whoami.overview
    ? 'HQ+ overview — every room, headings only'
    : `${whoami.room ?? 'none'}${whoami.roomName ? ` (${whoami.roomName})` : ''}`
  return [
    `Session: ${whoami.sessionId ?? 'none (not an Orca chat)'}`,
    `Room: ${room}`,
    `Project: ${whoami.project ?? 'none'}`,
    `Address: ${whoami.address ?? 'none yet'}`,
    `Task: ${whoami.task ?? 'none'}`
  ].join('\n')
}
