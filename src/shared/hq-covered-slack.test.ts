import { describe, expect, it } from 'vitest'
import { hqCoveredSlackMessages } from './hq-covered-slack'
import type { PulseInboxItem, PulseWaiting } from './pulse-types'

const NOW = 1_800_000_000_000

function waiting(over: Partial<PulseWaiting>): PulseWaiting {
  return {
    direction: 'on-them',
    status: 'open',
    sourceRef: null,
    resolvedAt: null,
    repliedAt: null,
    replyLink: null,
    ...over
  } as PulseWaiting
}

function intake(refId: object, createdAt = NOW): PulseInboxItem {
  return { kind: 'hq-intake', refId: JSON.stringify(refId), createdAt } as PulseInboxItem
}

describe('hqCoveredSlackMessages', () => {
  it('names the question thread and the answer a waiting took, and what the intake raised', () => {
    const keys = hqCoveredSlackMessages(
      [
        waiting({
          sourceRef: 'slack:D0ANN0001:1792620937.084909',
          repliedAt: NOW,
          replyLink:
            'https://acme.slack.com/archives/D0ANN0001/p1793033992743889?thread_ts=1792620937.084909'
        }),
        waiting({ sourceRef: 'slack:D0BOB0001:1792000000.000100' })
      ],
      [
        intake({
          channel: 'C0HUB0001',
          ts: '1793027931.250479',
          threadTs: null,
          author: 'Ann',
          venue: 'channel',
          text: 'x',
          at: NOW,
          summary: 'x'
        })
      ],
      NOW - 1000
    )
    expect(keys).toEqual(
      new Set([
        'D0ANN0001:1792620937.084909',
        'D0ANN0001:1793033992.743889',
        'C0HUB0001:1793027931.250479'
      ])
    )
  })
})
