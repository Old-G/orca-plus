// Custom build (hq-plus-sessions): what a chat the dispatcher opens is told first — the thread it
// takes over, how the last chat on it ended, where to read the rest, and the work itself.
import type { HqJournalEntry } from '../../shared/hq-journal'

const BODY_MAX = 1200

function stamp(at: number): string {
  const day = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(day.getDate())}.${pad(day.getMonth() + 1)} ${pad(day.getHours())}:${pad(day.getMinutes())}`
}

export function hqNewChatPrompt(args: {
  address: string
  project: string
  /** The last report of the chat this one takes over; null for a new thread. */
  lastReport: HqJournalEntry | null
  work: string
}): string {
  const { address, project, lastReport } = args
  const lines = [`Orca+ · ты ведёшь нить ${address}.`]
  if (lastReport) {
    const body = (lastReport.body ?? '').slice(0, BODY_MAX)
    lines.push(
      '',
      `Прошлый чат этой нити закончил так (${stamp(lastReport.at)}): ${lastReport.title}`,
      ...(body ? ['"""', body, '"""'] : [])
    )
  }
  lines.push(
    '',
    `Сначала прочитай нить и карточку проекта: \`orca hq thread ${address}\` и \`orca hq context ${project}\`.`,
    'Задача:',
    '"""',
    args.work,
    '"""',
    '',
    'В конце каждого хода — `orca hq report`.'
  )
  return lines.join('\n')
}
