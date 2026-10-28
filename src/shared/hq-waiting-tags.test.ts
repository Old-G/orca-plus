import { describe, expect, it } from 'vitest'
import {
  hqWaitingSnoozeDay,
  hqWaitingSourceUrl,
  hqWaitingTaskRef,
  readHqWaitingTags,
  withHqWaitingAsked,
  withHqWaitingTag
} from './hq-waiting-tags'

describe('waiting tags in the detail', () => {
  it('keeps the text apart from the tags, and setting one leaves the rest', () => {
    let detail = withHqWaitingTag('Asked in the thread', 'task', 'DEV-18102')
    detail = withHqWaitingTag(detail, 'snoozedUntil', '2026-10-27')
    detail = withHqWaitingTag(detail, 'task', 'DEV-18197')
    const tags = readHqWaitingTags(detail)
    expect(tags.text).toBe('Asked in the thread')
    expect(tags.task).toBe('DEV-18197')
    expect(tags.snoozedUntil).toBe(new Date(2026, 9, 27).getTime())
    expect(readHqWaitingTags(withHqWaitingTag(detail, 'snoozedUntil', null)).snoozedUntil).toBe(
      null
    )
  })

  it('snoozes to tomorrow, next Monday or a week on', () => {
    const friday = new Date(2026, 9, 23, 18).getTime()
    expect(hqWaitingSnoozeDay('tomorrow', friday)).toBe('2026-10-24')
    expect(hqWaitingSnoozeDay('monday', friday)).toBe('2026-10-26')
    expect(hqWaitingSnoozeDay('week', friday)).toBe('2026-10-30')
  })

  it('turns the refs ask-person records into links', () => {
    expect(hqWaitingSourceUrl('slack:C0123ABC:1792423366.103169')).toBe(
      'https://slack.com/archives/C0123ABC/p1792423366103169'
    )
    expect(hqWaitingSourceUrl('clickup:12487v2h86b:9001')).toBe(
      'https://app.clickup.com/t/12487v2h86b'
    )
    expect(hqWaitingSourceUrl('slack:C1:not-a-ts')).toBe(null)
  })

  it('takes a task id or a link, nothing else', () => {
    expect(hqWaitingTaskRef(' dev-18102 ')).toBe('DEV-18102')
    expect(hqWaitingTaskRef('https://app.clickup.com/t/abc')).toBe('https://app.clickup.com/t/abc')
    expect(hqWaitingTaskRef('soon')).toBe(null)
  })
})

describe('withHqWaitingAsked', () => {
  it("puts the owner's words ahead of the tags only when the detail has no text of its own", () => {
    expect(withHqWaitingAsked(null, 'Which hours?')).toBe('Which hours?')
    expect(withHqWaitingAsked('Task: DEV-7', 'Which hours?')).toBe('Which hours?\nTask: DEV-7')
    expect(withHqWaitingAsked('Saved note\nTask: DEV-7', 'Which hours?')).toBe(
      'Saved note\nTask: DEV-7'
    )
    expect(withHqWaitingAsked(null, '  ')).toBeNull()
  })

  it('drops a line of the words that reads like a tag', () => {
    const detail = withHqWaitingAsked(null, 'Please check\nTask: DEV-9')
    expect(detail).toBe('Please check')
    expect(readHqWaitingTags(detail).task).toBeNull()
  })
})
