import { describe, expect, it, vi } from 'vitest'
import type { HqRoute } from '../../shared/hq-router'
import { hqSweepDraftOf, sweepHqCardRoutes, type HqSweepCard } from './hq-router-sweep'

const route: HqRoute = {
  target: 'worker',
  targetTitle: 'W · billing',
  repoId: null,
  project: null,
  level: 'worker',
  how: 'model',
  why: 'it names DEV-1',
  auto: false,
  alternatives: [],
  confidence: null,
  model: 'Jev'
}

function card(id: string, ref: string, body = 'Do · Billing'): HqSweepCard {
  return {
    id,
    dedupeKey: `slack-request:${id}`,
    title: 'Ann: fix refunds',
    body,
    refId: JSON.stringify({ id: ref, kind: 'do' }),
    createdAt: 1_000
  }
}

function setup(cards: HqSweepCard[]) {
  const saved = new Map<string, { route: HqRoute | null; at: number; tries: number }>()
  const bodies = new Map<string, string>()
  const calls: string[] = []
  return {
    saved,
    bodies,
    calls,
    deps: {
      cards: () => cards,
      draftOf: hqSweepDraftOf,
      route: vi.fn(async (draft) => {
        calls.push(`${draft.channel}:${draft.ts}`)
        return route
      }),
      cardRoute: (key: string) => saved.get(key) ?? null,
      saveCardRoute: (key: string, r: HqRoute | null, at: number) =>
        void saved.set(key, { route: r, at, tries: 1 }),
      setBody: (id: string, body: string) => void bodies.set(id, body),
      now: () => 5_000
    }
  }
}

describe('sweepHqCardRoutes', () => {
  it('reads a Slack thread and a ClickUp task from a request, and nothing else', () => {
    expect(hqSweepDraftOf(card('a', 'C0AAAAAAAAA:1792600000.000100'))).toMatchObject({
      channel: 'C0AAAAAAAAA',
      ts: '1792600000.000100',
      author: 'Ann'
    })
    expect(hqSweepDraftOf(card('b', 'clickup:86abc'))).toMatchObject({
      channel: 'clickup',
      ts: '86abc'
    })
    expect(hqSweepDraftOf(card('c', 'weird'))).toBeNull()
  })

  it('routes each card once and writes the line once, however often it passes', async () => {
    const cards = [card('a', 'C0AAAAAAAAA:1792600000.000100'), card('b', 'clickup:86abc')]
    const { deps, bodies, calls } = setup(cards)
    expect(await sweepHqCardRoutes(deps)).toBe(2)
    expect(bodies.get('a')).toBe('Do · Billing\n→ «W · billing» — it names DEV-1')
    // The pass again, with the bodies as written: no call, no second line.
    for (const [id, body] of bodies) {
      const held = cards.find((entry) => entry.id === id)
      if (held) {
        held.body = body
      }
    }
    bodies.clear()
    expect(await sweepHqCardRoutes(deps)).toBe(0)
    expect(bodies.size).toBe(0)
    expect(calls).toHaveLength(2)
  })

  it('a rebuilt card with the same key takes the kept route without a call', async () => {
    const { deps, bodies, calls } = setup([card('a', 'C0AAAAAAAAA:1792600000.000100')])
    await sweepHqCardRoutes(deps)
    bodies.clear()
    expect(await sweepHqCardRoutes(deps)).toBe(0)
    expect(calls).toHaveLength(1)
    expect(bodies.get('a')).toContain('→ «W · billing»')
  })

  it('makes at most three calls a pass; the rest wait', async () => {
    const cards = ['1', '2', '3', '4', '5'].map((n) => card(n, `C0AAAAAAAAA:179260000${n}.000100`))
    const { deps, calls } = setup(cards)
    expect(await sweepHqCardRoutes(deps)).toBe(3)
    expect(await sweepHqCardRoutes(deps)).toBe(2)
    expect(calls).toHaveLength(5)
  })
})
