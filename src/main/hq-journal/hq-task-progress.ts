// Custom build (hq-task-progress, C7 28.11): adds a line to «Ход» of the row file of the chat's plan
// row when the chat reports a work event (PR opened, merged, shipped). Only `runs/<plan>/<row>.md`
// is written, never the plan itself. Same row and event and link again adds nothing.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HqTaskKey } from '../../shared/hq-task-lock'
import type {
  HqTaskEvent,
  HqTaskProgressResult,
  HqTaskProgressRow
} from '../../shared/hq-task-progress'

export type HqTaskProgressDeps = {
  enabled: () => boolean
  hqPath: () => string | null
  /** The plan rows held by these chats. */
  rowsOf: (sessionIds: readonly string[]) => HqTaskKey[]
  liveSessionOf: (sessionId: string) => string
  now: () => number
  read?: (path: string) => Promise<string | null>
  write?: (path: string, text: string) => Promise<void>
}

export type HqTaskProgress = {
  record: (ask: {
    callerSessionId: string
    event: HqTaskEvent
    link?: string
    note?: string
  }) => Promise<HqTaskProgressResult>
}

const LABEL: Record<HqTaskEvent, string> = {
  opened: 'PR открыт',
  merged: 'PR влит',
  shipped: 'выкачено'
}

const HEADING = '## Ход'
// Same shapes as hq-task-lock reads from a brief; a value from the table is checked again before it is a path.
const SAFE_PLAN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[A-Za-z0-9._-]{1,120}$/
const SAFE_ROW = /^[A-Z][A-Za-z0-9]{0,23}$/

function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** One line of «Ход»: `- 14:05 PR влит · <link> · <note>`; text from a chat is cut to one short line. */
export function hqTaskProgressLine(
  event: HqTaskEvent,
  at: number,
  link?: string,
  note?: string
): string {
  const oneLine = (text: string | undefined): string | null => {
    const clean = text?.replace(/\s+/g, ' ').trim().slice(0, 300)
    return clean ? clean : null
  }
  const parts = [LABEL[event], oneLine(link), oneLine(note)].filter((part) => part !== null)
  return `- ${clock(at)} ${parts.join(' · ')}`
}

/** The text with `line` last in «Ход» (the heading is added when missing); null when the section has it already. */
export function hqInsertProgressLine(text: string, line: string): string | null {
  const crlf = text.includes('\r\n')
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  // Why `## Ход` and what follows it (`## Ход работы`): a file written by hand may name it so.
  const start = lines.findIndex((entry) => /^##\s+Ход(\s|$)/.test(entry))
  if (start === -1) {
    const base = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`
    const added = `${base}${text.length === 0 ? '' : '\n'}${HEADING}\n${line}\n`
    return crlf ? added.replace(/\r?\n/g, '\r\n') : added
  }
  let end = lines.findIndex((entry, index) => index > start && /^#{1,2}\s/.test(entry))
  if (end === -1) {
    end = lines.length
  }
  // Why the time and the note are not compared: the same event and link a minute later (or with
  // another note) is still the same fact; and only «Ход» counts, not a line of another section.
  const identity = (entry: string): string =>
    entry
      .replace(/^- \d\d:\d\d /, '')
      .split(' · ')
      .slice(0, 2)
      .join(' · ')
  const mine = identity(line)
  if (
    lines.slice(start + 1, end).some((entry) => entry.startsWith('- ') && identity(entry) === mine)
  ) {
    return null
  }
  // Why: insert after the last non-empty line of the section, so a blank line before the next heading stays.
  let at = end
  while (at > start + 1 && lines[at - 1].trim() === '') {
    at -= 1
  }
  lines.splice(at, 0, line)
  const next = lines.join('\n')
  const done = next.endsWith('\n') ? next : `${next}\n`
  return crlf ? done.replace(/\n/g, '\r\n') : done
}

export function createHqTaskProgress(deps: HqTaskProgressDeps): HqTaskProgress {
  const read =
    deps.read ?? ((path: string) => readFile(path, 'utf8').catch(() => null as string | null))
  const write =
    deps.write ??
    (async (path: string, text: string) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text)
    })
  return {
    record: async ({ callerSessionId, event, link, note }) => {
      if (!deps.enabled()) {
        return { event, ok: false, reason: 'off' }
      }
      const hq = deps.hqPath()
      if (!hq) {
        return { event, ok: false, reason: 'no-hq' }
      }
      // Why both ids: the row is held by the live end of a chat's handoff chain, the caller may be an older end.
      const live = deps.liveSessionOf(callerSessionId)
      // Why only the newest row: a chat that finished one row and took the next reports on the next.
      const held = deps.rowsOf(live === callerSessionId ? [live] : [live, callerSessionId])
      const keys = held.slice(-1)
      if (keys.length === 0) {
        return { event, ok: false, reason: 'no-row' }
      }
      const line = hqTaskProgressLine(event, deps.now(), link, note)
      const rows: HqTaskProgressRow[] = []
      for (const key of keys) {
        if (!SAFE_PLAN.test(key.plan) || !SAFE_ROW.test(key.row)) {
          rows.push({ ...key, status: 'skipped', line })
          continue
        }
        const path = join(hq, 'runs', key.plan, `${key.row}.md`)
        const next = hqInsertProgressLine((await read(path)) ?? '', line)
        if (next !== null) {
          await write(path, next)
        }
        rows.push({ ...key, status: next === null ? 'duplicate' : 'written', line })
      }
      return { event, ok: true, rows }
    }
  }
}

let provided: HqTaskProgress | null = null

export function provideHqTaskProgress(progress: HqTaskProgress | null): void {
  provided = progress
}

export function getHqTaskProgress(): HqTaskProgress | null {
  return provided
}
