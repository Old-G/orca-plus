import { describe, expect, it } from 'vitest'
import { dueHqNightTasks, hqNightTaskChanged, isHqNightShiftHour } from './hq-night-shift'
import type { HqTriageDecisions } from './hq-triage'

const at = (hour: number, minute = 0) => new Date(2026, 9, 17, hour, minute).getTime()

describe('isHqNightShiftHour', () => {
  it('spans midnight from the start hour to 7 in the morning', () => {
    expect(isHqNightShiftHour(at(22, 59), 23)).toBe(false)
    expect(isHqNightShiftHour(at(23), 23)).toBe(true)
    expect(isHqNightShiftHour(at(3), 23)).toBe(true)
    expect(isHqNightShiftHour(at(7), 23)).toBe(false)
    expect(isHqNightShiftHour(at(14), 23)).toBe(false)
  })

  it('takes a start after midnight too', () => {
    expect(isHqNightShiftHour(at(0), 1)).toBe(false)
    expect(isHqNightShiftHour(at(2), 1)).toBe(true)
  })
})

describe('dueHqNightTasks', () => {
  const decisions: HqTriageDecisions = {
    queued: { decision: 'night', at: 1, repoIds: ['r1', 'r2'] },
    triedTonight: { decision: 'night', at: 1, repoIds: ['r1'], nightTriedAt: at(23, 5) },
    triedLastNight: {
      decision: 'night',
      at: 1,
      repoIds: ['r1'],
      nightTriedAt: at(23) - 24 * 3600_000
    },
    noProject: { decision: 'night', at: 1, repoIds: [] },
    taken: { decision: 'taken', at: 1, repoId: 'r1' }
  }

  it('starts queued tasks at night, one try per night, and none by day', () => {
    expect(dueHqNightTasks(decisions, at(23, 30), 23)).toEqual([
      { taskId: 'queued', repoIds: ['r1', 'r2'] },
      { taskId: 'triedLastNight', repoIds: ['r1'] }
    ])
    expect(dueHqNightTasks(decisions, at(15), 23)).toEqual([])
  })
})

describe('changed tasks', () => {
  it('sets aside a task edited after it was queued', () => {
    expect(hqNightTaskChanged(100, 100)).toBe(false)
    expect(hqNightTaskChanged(100, 200)).toBe(true)
    expect(hqNightTaskChanged(undefined, 200)).toBe(true)
    expect(
      dueHqNightTasks(
        { t: { decision: 'night', at: 1, repoIds: ['r1'], nightSkipped: 'changed' } },
        new Date(2026, 9, 17, 23, 30).getTime(),
        23
      )
    ).toEqual([])
  })
})
