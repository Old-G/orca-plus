import { describe, expect, it } from 'vitest'
import type { HqAttributionAccuracy } from '../shared/hq-attribution'
import { formatHqAccuracy } from './hq-accuracy-format'

function result(overrides: Partial<HqAttributionAccuracy> = {}): HqAttributionAccuracy {
  return {
    since: 0,
    cards: { decided: 0, wrong: 0 },
    slices: [
      {
        source: 'slack',
        field: 'project',
        decided: 4,
        confirmed: 3,
        edited: 1,
        skipped: 2,
        rate: 0.75
      }
    ],
    topEdits: [],
    whys: [],
    ...overrides
  }
}

describe('formatHqAccuracy', () => {
  it('says nothing is decided yet without slices', () => {
    expect(formatHqAccuracy(result({ slices: [] }))).toMatch(/^No guesses decided yet/)
  })

  it('opens with the cards sent as suggested and with a change', () => {
    const text = formatHqAccuracy(result({ cards: { decided: 5, wrong: 2 } }))
    expect(text.split('\n')[0]).toBe('Cards: 5 sent, 3 as HQ suggested, 2 with a change')
    expect(text).toContain('75%  slack · project')
  })

  it('leaves the cards line out when no card was sent', () => {
    expect(formatHqAccuracy(result())).not.toContain('Cards:')
  })

  it('prints a reason stored on several fields of one card once, naming the fields', () => {
    const text = formatHqAccuracy(
      result({
        whys: [
          { source: 'slack', field: 'project', text: 'Ann asks for the\n acme shop' },
          { source: 'slack', field: 'chat', text: 'Ann asks for the\n acme shop' },
          { source: 'slack', field: 'project', text: 'Bob is on support' }
        ]
      })
    )
    expect(text).toContain(
      [
        'Your reasons, newest first:',
        '  slack · project, chat: Ann asks for the acme shop',
        '  slack · project: Bob is on support'
      ].join('\n')
    )
  })
})
