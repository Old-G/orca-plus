import { describe, expect, it } from 'vitest'
import { hqPlusWaitGroups } from './hq-plus-wait-groups'

describe('we-wait groups', () => {
  it('puts a linked task in Tracked and a snooze last, until its day comes', () => {
    const now = new Date(2026, 9, 24, 12).getTime()
    const waits = [
      { id: 'a', task: null, snoozedUntil: null },
      { id: 'b', task: 'DEV-1', snoozedUntil: null },
      { id: 'c', task: null, snoozedUntil: new Date(2026, 9, 27).getTime() },
      { id: 'd', task: 'DEV-2', snoozedUntil: new Date(2026, 9, 24).getTime() }
    ]
    const groups = hqPlusWaitGroups(waits, now)
    expect(groups.chase.map((wait) => wait.id)).toEqual(['a'])
    expect(groups.tracked.map((wait) => wait.id)).toEqual(['b', 'd'])
    expect(groups.snoozed.map((wait) => wait.id)).toEqual(['c'])
  })
})
