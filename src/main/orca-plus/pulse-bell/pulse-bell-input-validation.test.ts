import { describe, expect, it } from 'vitest'
import { readPulseBellInputs } from './pulse-bell-input-validation'

describe('readPulseBellInputs', () => {
  it('keeps well-formed items and normalizes optional fields', () => {
    expect(
      readPulseBellInputs([
        {
          kind: 'claude-limit',
          title: 'Account A at 92%',
          dedupeKey: 'limit:A',
          urgency: 'urgent',
          refId: 'acc-b',
          actions: [{ id: 'switch', label: 'Switch account' }, { id: 7 }, null]
        },
        { kind: 'claude-limit', title: 'B', dedupeKey: 'limit:B', urgency: 'loud', body: '' }
      ])
    ).toEqual([
      {
        kind: 'claude-limit',
        title: 'Account A at 92%',
        dedupeKey: 'limit:A',
        urgency: 'urgent',
        body: null,
        refKind: null,
        refId: 'acc-b',
        actions: [{ id: 'switch', label: 'Switch account' }]
      },
      {
        kind: 'claude-limit',
        title: 'B',
        dedupeKey: 'limit:B',
        urgency: 'normal',
        body: null,
        refKind: null,
        refId: null,
        actions: []
      }
    ])
  })

  it('drops items without kind, title or dedupe key, and anything that is not a list', () => {
    expect(readPulseBellInputs('nope')).toEqual([])
    expect(
      readPulseBellInputs([
        null,
        { title: 'x', dedupeKey: 'k' },
        { kind: 'k', dedupeKey: 'k' },
        { kind: 'k', title: 'x' },
        { kind: 'k', title: 'x'.repeat(2_001), dedupeKey: 'k' }
      ])
    ).toEqual([])
  })

  it('caps the number of items', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      kind: 'k',
      title: 't',
      dedupeKey: `${i}`
    }))
    expect(readPulseBellInputs(many)).toHaveLength(20)
  })
})
