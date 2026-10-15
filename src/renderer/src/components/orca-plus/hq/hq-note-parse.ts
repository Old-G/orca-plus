// Custom build (hq-notes): one line typed into HQ's «Notes» — «@Ирина жду выгрузку до пт» — read into
// who, which way the waiting goes, what, and by when. Anything it cannot read stays in the text.
import type { PulseWaitingDirection } from '../../../../../shared/pulse-types'

/** A plain note: no person, nobody waits. Stored as a waiting with this source. */
export const HQ_NOTE_SOURCE = 'note'

export type HqParsedNote = {
  title: string
  personName: string | null
  /** null for a plain note. */
  direction: PulseWaitingDirection | null
  dueAt: number | null
}

const MENTION = /(^|\s)@([\p{L}][\p{L}\p{N}_.-]*)/u
const I_WAIT = /(^|\s)(жду|ожидаю|waiting for|waiting on|i wait for)(?=\s|$)/iu
const WAITS_ON_ME = /(^|\s)(ждёт|ждет|ждут|просит|просила|просил|waits|asks|is waiting)(?=\s|$)/iu

const WEEKDAYS: readonly (readonly string[])[] = [
  ['вс', 'воскресенья', 'воскресенье', 'sun', 'sunday'],
  ['пн', 'понедельника', 'понедельник', 'mon', 'monday'],
  ['вт', 'вторника', 'вторник', 'tue', 'tuesday'],
  ['ср', 'среды', 'среда', 'wed', 'wednesday'],
  ['чт', 'четверга', 'четверг', 'thu', 'thursday'],
  ['пт', 'пятницы', 'пятница', 'fri', 'friday'],
  ['сб', 'субботы', 'суббота', 'sat', 'saturday']
]

function endOfDay(at: Date): number {
  const day = new Date(at)
  day.setHours(23, 59, 0, 0)
  return day.getTime()
}

/** «до пт», «к пятнице», «завтра», «сегодня», «20.10» → the end of that day, or null. */
function readDue(text: string, now: number): { dueAt: number; match: string } | null {
  const base = new Date(now)
  const lower = text.toLowerCase()
  const relative = /(^|\s)((?:до|к|by)\s+)?(сегодня|today|завтра|tomorrow)(?=\s|$|[.,!?])/u.exec(
    lower
  )
  if (relative?.[3]) {
    const day = new Date(base)
    if (relative[3] === 'завтра' || relative[3] === 'tomorrow') {
      day.setDate(day.getDate() + 1)
    }
    return { dueAt: endOfDay(day), match: relative[0] }
  }
  const dated = /(^|\s)((?:до|к|by)\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s|$|[,!?])/u.exec(
    lower
  )
  if (dated?.[3] && dated[4]) {
    const year = dated[5]
      ? Number(dated[5].length === 2 ? `20${dated[5]}` : dated[5])
      : base.getFullYear()
    const day = new Date(year, Number(dated[4]) - 1, Number(dated[3]))
    if (!dated[5] && endOfDay(day) < now) {
      day.setFullYear(year + 1)
    }
    return Number.isNaN(day.getTime()) ? null : { dueAt: endOfDay(day), match: dated[0] }
  }
  const weekday = /(^|\s)(?:до|к|by)\s+([\p{L}]+)(?=\s|$|[.,!?])/u.exec(lower)
  const index = weekday?.[2] ? WEEKDAYS.findIndex((names) => names.includes(weekday[2]!)) : -1
  if (weekday && index >= 0) {
    const day = new Date(base)
    const ahead = (index - day.getDay() + 7) % 7 || 7
    day.setDate(day.getDate() + ahead)
    return { dueAt: endOfDay(day), match: weekday[0] }
  }
  return null
}

export function parseHqNote(text: string, now: number): HqParsedNote {
  let rest = text.trim()
  const mention = MENTION.exec(rest)
  const personName = mention?.[2] ?? null
  if (mention) {
    rest = `${rest.slice(0, mention.index)}${mention[1]}${rest.slice(mention.index + mention[0].length)}`
  }
  const due = readDue(rest, now)
  const direction: PulseWaitingDirection | null = WAITS_ON_ME.test(rest)
    ? 'on-me'
    : I_WAIT.test(rest) || personName
      ? 'on-them'
      : null
  const title = rest.replace(/\s+/g, ' ').trim()
  return { title: title || text.trim(), personName, direction, dueAt: due?.dueAt ?? null }
}
