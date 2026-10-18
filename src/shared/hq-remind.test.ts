import { describe, expect, it } from 'vitest'
import {
  HQ_REMIND_KIND,
  hqRemindBellItems,
  hqRemindDue,
  hqRemindPrompt,
  hqWorkingDaysBetween
} from './hq-remind'
import { pulseWaitingFixture } from './hq-promises.test'

// Monday 12.10.2026, local noon.
const MONDAY = new Date(2026, 9, 12, 12).getTime()
const DAY = 24 * 60 * 60_000

function asked(overrides: Parameters<typeof pulseWaitingFixture>[0] = {}) {
  return pulseWaitingFixture({ direction: 'on-them', title: 'Доступ к БД', ...overrides })
}

describe('hqWorkingDaysBetween', () => {
  it('counts Mon–Fri only', () => {
    expect(hqWorkingDaysBetween(MONDAY, MONDAY + 2 * DAY)).toBe(2)
    // Friday → next Monday is one working day.
    expect(hqWorkingDaysBetween(MONDAY + 4 * DAY, MONDAY + 7 * DAY)).toBe(1)
  })
})

describe('hqRemindDue', () => {
  it('takes open questions to people unanswered for two working days', () => {
    const now = MONDAY + 2 * DAY
    const due = hqRemindDue(
      [
        asked({ id: 'old', createdAt: MONDAY }),
        asked({ id: 'fresh', createdAt: MONDAY + DAY }),
        asked({ id: 'answered', createdAt: MONDAY, reply: 'да', replyTs: '1.2' }),
        asked({ id: 'mine', createdAt: MONDAY, direction: 'on-me' }),
        asked({ id: 'closed', createdAt: MONDAY, status: 'resolved' })
      ],
      now
    )
    expect(due.map((waiting) => waiting.id)).toEqual(['old'])
  })

  it('stays quiet on a weekend', () => {
    expect(hqRemindDue([asked({ createdAt: MONDAY })], MONDAY + 5 * DAY)).toEqual([])
  })
})

describe('hqRemindBellItems', () => {
  it('raises one line per question, with a key that changes every two working days', () => {
    const waiting = asked({ id: 'w1', personId: 'p1', createdAt: MONDAY, project: 'acme-flows' })
    const [first] = hqRemindBellItems([waiting], () => 'Петя', MONDAY + 2 * DAY)
    expect(first).toMatchObject({
      kind: HQ_REMIND_KIND,
      title: 'No answer from Петя: Доступ к БД',
      body: 'Asked 2 working days ago · acme-flows',
      refId: 'w1'
    })
    const [later] = hqRemindBellItems([waiting], () => 'Петя', MONDAY + 3 * DAY)
    expect(later.dedupeKey).toBe(first.dedupeKey)
    const [again] = hqRemindBellItems([waiting], () => 'Петя', MONDAY + 4 * DAY)
    expect(again.dedupeKey).not.toBe(first.dedupeKey)
  })
})

describe('hqRemindPrompt', () => {
  it('names the person, the place, the skill and the existing waiting', () => {
    const prompt = hqRemindPrompt(
      asked({ id: 'w1', createdAt: MONDAY, sourceRef: 'https://x.slack.com/archives/C1/p1' }),
      'Петя',
      MONDAY + 2 * DAY
    )
    expect(prompt).toContain('Напомни Петя про «Доступ к БД» по скиллу ask-person')
    expect(prompt).toContain('https://x.slack.com/archives/C1/p1')
    expect(prompt).toContain('id w1')
    expect(prompt).toContain('Approve')
  })
})
