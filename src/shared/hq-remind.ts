// Custom build (hq-remind): a question to a person left unanswered for two working days, as a bell
// line with «Remind» — an HQ chat writes the nudge by the ask-person skill, and it goes out only
// through Approve.
import { PULSE_BELL_ACTION, type PulseBellInput } from './pulse-bell'
import type { PulseWaiting } from './pulse-types'

export const HQ_REMIND_KIND = 'hq-remind'
export const HQ_REMIND_ACTION = 'hq-remind'
// Why: two days without an answer is when the owner would chase it himself (owner, 18.10).
export const HQ_REMIND_AFTER_DAYS = 2

const DAY_MS = 24 * 60 * 60_000

function isWeekend(at: number): boolean {
  const weekday = new Date(at).getDay()
  return weekday === 0 || weekday === 6
}

/** Whole working days (Mon–Fri) from `from` to `now`. */
export function hqWorkingDaysBetween(from: number, now: number): number {
  let days = 0
  for (let at = from + DAY_MS; at <= now; at += DAY_MS) {
    if (!isWeekend(at)) {
      days += 1
    }
  }
  return days
}

/** Open questions to people with no answer yet, two working days or older; none on a weekend. */
export function hqRemindDue(waitings: readonly PulseWaiting[], now: number): PulseWaiting[] {
  if (isWeekend(now)) {
    return []
  }
  return waitings.filter(
    (waiting) =>
      waiting.status === 'open' &&
      waiting.direction === 'on-them' &&
      waiting.reply === null &&
      waiting.replyTs === null &&
      hqWorkingDaysBetween(waiting.createdAt, now) >= HQ_REMIND_AFTER_DAYS
  )
}

/** One line per unanswered question; «Not now» quiets it for two more working days. */
export function hqRemindBellItems(
  waitings: readonly PulseWaiting[],
  personName: (personId: string) => string | null,
  now: number
): PulseBellInput[] {
  return hqRemindDue(waitings, now).map((waiting) => {
    const days = hqWorkingDaysBetween(waiting.createdAt, now)
    const who = waiting.personId ? personName(waiting.personId) : null
    return {
      kind: HQ_REMIND_KIND,
      title: `No answer${who ? ` from ${who}` : ''}: ${waiting.title}`.slice(0, 300),
      body: [`Asked ${days} working days ago`, waiting.project].filter(Boolean).join(' · '),
      refKind: 'waiting',
      refId: waiting.id,
      actions: [
        { id: HQ_REMIND_ACTION, label: 'Remind' },
        { id: PULSE_BELL_ACTION.dismiss, label: 'Not now' }
      ],
      dedupeKey: `${HQ_REMIND_KIND}:${waiting.id}:${Math.floor(days / HQ_REMIND_AFTER_DAYS)}`
    }
  })
}

/** What the HQ chat is asked: the same place, a short nudge, and no second waiting. */
export function hqRemindPrompt(
  waiting: Pick<PulseWaiting, 'id' | 'title' | 'createdAt'> & {
    sourceRef?: string | null
    detail?: string | null
  },
  person: string | null,
  now: number
): string {
  const days = hqWorkingDaysBetween(waiting.createdAt, now)
  const where = waiting.sourceRef ? ` Где спрашивали: ${waiting.sourceRef}.` : ''
  const detail = waiting.detail ? `\nКонтекст: ${waiting.detail.slice(0, 1000)}` : ''
  return (
    `Напомни ${person ?? 'человеку'} про «${waiting.title}» по скиллу ask-person.${where}` +
    `${detail}\nОтвета нет ${days} раб. дн. Пиши в то же место (тот же тред или задача), коротко и ` +
    `по-человечески, без пересказа всего вопроса. Ожидание уже записано (id ${waiting.id}) — ` +
    'новое не заводи. Уходит только через Approve.'
  )
}
