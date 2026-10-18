import { describe, expect, it, vi } from 'vitest'
import type { HqClientSettings } from '../../shared/hq-client-settings'
import { markHqPinnedSeen, readHqPinnedCounts, type HqPinnedSettings } from './hq-pinned-counts'

function hq(seen: Record<string, number>): HqPinnedSettings & { updates: unknown[] } {
  const updates: unknown[] = []
  return {
    updates,
    settings: (): HqClientSettings => ({ hqPinnedSeenAt: seen }),
    updateSettings: (update): HqClientSettings => {
      updates.push(update)
      return {}
    },
    reports: vi.fn(async () => ({ ok: false as const, error: 'No HQ folder is set.' }))
  }
}

describe('markHqPinnedSeen', () => {
  it('keeps the other items’ moments', () => {
    const settings = hq({ feed: 5 })
    expect(markHqPinnedSeen(settings, 'reports', 9)).toEqual({ ok: true })
    expect(settings.updates).toEqual([{ hqPinnedSeenAt: { feed: 5, reports: 9 } }])
  })
})

describe('readHqPinnedCounts', () => {
  it('reads an HQ without reports as none', async () => {
    const counts = await readHqPinnedCounts(
      {
        pulseListInbox: () => [],
        pulseListWaitings: () => [],
        pulseListDecisions: () => [],
        pulseFeed: () => ({ items: [] })
      },
      hq({}),
      Date.now()
    )
    expect(counts).toEqual({ today: 0, onYou: 0, remind: 0, reports: 0, feed: 0, journal: 0 })
  })
})
