import { describe, expect, it } from 'vitest'
import {
  HQ_ROUTER_AUTO_CLASSES,
  HQ_ROUTER_AUTO_DEFAULTS,
  hqRouterAutoStatus,
  hqRouterAutoStatuses,
  hqRouterAutoThresholds
} from './hq-router-auto'

const T = HQ_ROUTER_AUTO_DEFAULTS

describe('router auto classes (T4)', () => {
  it('defaults to n ≥ 30, ≥ 98%, 30 days; the settings override each, bad values fall back', () => {
    expect(hqRouterAutoThresholds(undefined)).toEqual({ minN: 30, minRight: 0.98, days: 30 })
    expect(hqRouterAutoThresholds({ minN: 10 })).toEqual({ minN: 10, minRight: 0.98, days: 30 })
    expect(hqRouterAutoThresholds({ minN: 0, minRight: 1.5, days: -1 })).toEqual(T)
    expect(hqRouterAutoThresholds({ minRight: 0.9, days: 7 })).toEqual({
      minN: 30,
      minRight: 0.9,
      days: 7
    })
  })

  it('a class goes auto only at n ≥ minN and right ≥ minRight', () => {
    expect(hqRouterAutoStatus('topic', undefined, T)).toMatchObject({ n: 0, auto: false })
    expect(hqRouterAutoStatus('topic', { n: 29, right: 29 }, T).auto).toBe(false)
    expect(hqRouterAutoStatus('topic', { n: 30, right: 30 }, T).auto).toBe(true)
    // 29 of 30 is 96.7%: below 98%.
    expect(hqRouterAutoStatus('topic', { n: 30, right: 29 }, T).auto).toBe(false)
    // 49 of 50 is exactly 98%.
    expect(hqRouterAutoStatus('topic', { n: 50, right: 49 }, T).auto).toBe(true)
    expect(hqRouterAutoStatus('topic', { n: 50, right: 48 }, T).auto).toBe(false)
    // A lower bar from the settings.
    expect(
      hqRouterAutoStatus('topic', { n: 5, right: 5 }, { minN: 5, minRight: 0.98, days: 30 }).auto
    ).toBe(true)
  })

  it('lists every class in a fixed order, unseen ones at n 0', () => {
    const statuses = hqRouterAutoStatuses(new Map([['question', { n: 40, right: 40 }]]), T)
    expect(statuses.map((entry) => entry.autoClass)).toEqual([...HQ_ROUTER_AUTO_CLASSES])
    expect(statuses.find((entry) => entry.autoClass === 'question')?.auto).toBe(true)
    expect(statuses.filter((entry) => entry.auto)).toHaveLength(1)
  })
})
