import { describe, expect, it } from 'vitest'
import {
  hqWaitingSnoozeDay,
  hqWaitingTaskRef,
  readHqWaitingTags,
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

  it('takes a task id or a link, nothing else', () => {
    expect(hqWaitingTaskRef(' dev-18102 ')).toBe('DEV-18102')
    expect(hqWaitingTaskRef('https://app.clickup.com/t/abc')).toBe('https://app.clickup.com/t/abc')
    expect(hqWaitingTaskRef('soon')).toBe(null)
  })
})
