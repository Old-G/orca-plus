import { describe, expect, it } from 'vitest'
import { createHqMergeSlots } from './hq-merge-slot'

describe('HQ+ merge slot: one merge per project at a time', () => {
  it('lets one chat merge, keeps the next waiting until release, renews on a repeat take, and frees a forgotten slot', () => {
    let now = 1_000
    const slots = createHqMergeSlots({ now: () => now, holdMs: 30 * 60_000 })
    expect(slots.take('acme-api', 'acme-api/codex-fix-a')).toEqual({ ok: true })
    expect(slots.take('acme-api', 'acme-api/codex-fix-a')).toEqual({ ok: true })
    expect(slots.take('acme-api', 'acme-api/other')).toEqual({
      ok: false,
      holder: 'acme-api/codex-fix-a',
      since: 1_000
    })
    expect(slots.take('kite', 'kite/fix')).toEqual({ ok: true })
    expect(slots.release('acme-api', 'acme-api/other')).toBe(false)
    expect(slots.release('acme-api', 'acme-api/codex-fix-a')).toBe(true)
    expect(slots.take('acme-api', 'acme-api/other')).toEqual({ ok: true })
    now += 25 * 60_000
    expect(slots.take('acme-api', 'acme-api/other')).toEqual({ ok: true })
    now += 25 * 60_000
    expect(slots.take('acme-api', 'acme-api/third')).toMatchObject({
      ok: false,
      holder: 'acme-api/other'
    })
    now += 31 * 60_000
    expect(slots.take('acme-api', 'acme-api/third')).toEqual({ ok: true })
  })
})
