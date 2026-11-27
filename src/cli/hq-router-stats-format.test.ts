import { describe, expect, it } from 'vitest'
import { formatHqRouterStats } from './hq-router-stats-format'

describe('formatHqRouterStats', () => {
  it('says so when nothing was routed', () => {
    expect(formatHqRouterStats({ days: 7, classes: [] })).toBe(
      'No routed cards in the last 7 days.'
    )
  })

  it('prints one line per class with the percentages', () => {
    const text = formatHqRouterStats({
      days: 30,
      classes: [
        {
          how: 'crumb',
          n: 4,
          chatRight: 3,
          workRight: 4,
          top3: 4,
          skipped: 1,
          gone: 0,
          open: 2,
          share: 0.8
        },
        {
          how: 'model',
          n: 1,
          chatRight: 0,
          workRight: 0,
          top3: 1,
          skipped: 0,
          gone: 2,
          open: 0,
          share: 0.2
        }
      ]
    })
    const lines = text.split('\n')
    expect(lines[0]).toBe('Last 30 days')
    expect(lines[2]).toMatch(/^crumb\s+4\s+75%\s+100%\s+100%\s+80%\s+1\s+0\s+2$/)
    expect(lines[3]).toMatch(/^model\s+1\s+0%\s+0%\s+100%\s+20%\s+0\s+2\s+0$/)
  })

  it('T4: prints each auto class — auto, gathering n of 30, or waiting on «Send» below the share', () => {
    const text = formatHqRouterStats({
      days: 7,
      classes: [],
      auto: {
        thresholds: { minN: 30, minRight: 0.98, days: 30 },
        classes: [
          { autoClass: 'thread-choice', n: 31, right: 31, auto: true },
          { autoClass: 'work-crumb', n: 4, right: 4, auto: false },
          { autoClass: 'question', n: 30, right: 27, auto: false }
        ]
      }
    })
    const lines = text.split('\n')
    expect(lines[0]).toBe('No routed cards in the last 7 days.')
    expect(lines[2]).toBe('Auto send (last 30 days: n ≥ 30, right ≥ 98%)')
    expect(lines[3]).toMatch(/^thread-choice\s+auto \(31 of 31 right\)$/)
    expect(lines[4]).toMatch(/^work-crumb\s+gathering: n 4 of 30$/)
    expect(lines[5]).toMatch(/^question\s+waits on «Send»: 27 of 30 right \(90%\)$/)
  })
})
