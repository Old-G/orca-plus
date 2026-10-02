import { describe, expect, it, vi } from 'vitest'
import type { PulseInboxInput, PulseInboxItem } from '../../shared/pulse-types'
import { raiseHqMorningBriefing } from './hq-morning-briefing'

function inbox(at: Date, items: PulseInboxItem[] = []) {
  const added: PulseInboxInput[] = []
  const deps = {
    now: () => at.getTime(),
    listInbox: vi.fn(() => items),
    addInboxItem: vi.fn((input: PulseInboxInput) => void added.push(input)),
    markInboxDone: vi.fn()
  }
  return { deps, added }
}

function item(dedupeKey: string, doneAt: number | null): PulseInboxItem {
  return {
    id: dedupeKey,
    kind: 'hq-briefing',
    title: 'Morning briefing',
    body: null,
    urgency: 'normal',
    refKind: null,
    refId: null,
    actions: [],
    dedupeKey,
    createdAt: 0,
    readAt: null,
    doneAt,
    doneAction: null
  }
}

describe('the morning briefing bell item', () => {
  it('waits for 10:00, then raises one item a day', () => {
    const early = inbox(new Date(2026, 9, 3, 9, 59))
    expect(raiseHqMorningBriefing(early.deps, null)).toBeNull()
    expect(early.added).toEqual([])

    const due = inbox(new Date(2026, 9, 3, 10, 0))
    expect(raiseHqMorningBriefing(due.deps, null)).toBe('2026-10-03')
    expect(due.added).toEqual([
      expect.objectContaining({
        kind: 'hq-briefing',
        dedupeKey: 'hq-briefing:2026-10-03',
        actions: [{ id: 'open', label: 'Open' }]
      })
    ])
    expect(raiseHqMorningBriefing(due.deps, '2026-10-03')).toBe('2026-10-03')
    expect(due.added).toHaveLength(1)
  })

  it('does not raise again a briefing dismissed earlier today, even after a restart', () => {
    const later = inbox(new Date(2026, 9, 3, 15, 0), [item('hq-briefing:2026-10-03', 1)])
    expect(raiseHqMorningBriefing(later.deps, null)).toBe('2026-10-03')
    expect(later.added).toEqual([])
  })

  it('closes yesterday’s open briefing when today’s arrives', () => {
    const next = inbox(new Date(2026, 9, 4, 11, 0), [
      item('hq-briefing:2026-10-03', null),
      item('hq-briefing:2026-10-02', 5)
    ])
    raiseHqMorningBriefing(next.deps, null)
    expect(next.deps.markInboxDone).toHaveBeenCalledTimes(1)
    expect(next.deps.markInboxDone).toHaveBeenCalledWith('hq-briefing:2026-10-03', 'superseded')
    expect(next.added.map((input) => input.dedupeKey)).toEqual(['hq-briefing:2026-10-04'])
  })
})
