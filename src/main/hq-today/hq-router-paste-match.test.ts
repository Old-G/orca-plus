import { describe, expect, it } from 'vitest'
import type { HqIntake } from '../../shared/hq-slack-intake'
import { hqRouterPasteMatches } from './hq-router-paste-match'

const card = (over: Partial<HqIntake>): HqIntake =>
  ({
    channel: 'C1',
    ts: '1700000000.000100',
    text: 'Ann: can you check the Acme invoice export before Friday please',
    ...over
  }) as HqIntake

describe('hqRouterPasteMatches', () => {
  it('matches a link to the marked message', () => {
    const link = 'https://acme.slack.com/archives/C1/p1700000000000100'
    expect(hqRouterPasteMatches(`see ${link}`, [card({})])).toEqual(['slack:C1:1700000000.000100'])
  })

  it('matches a link to a message folded into the card, not another channel', () => {
    const folded = card({ more: ['1700000005.000200'] })
    expect(
      hqRouterPasteMatches('https://acme.slack.com/archives/C1/p1700000005000200', [folded])
    ).toHaveLength(1)
    expect(
      hqRouterPasteMatches('https://acme.slack.com/archives/C2/p1700000005000200', [folded])
    ).toEqual([])
  })

  it('matches the card words pasted in, whatever the spacing and case', () => {
    expect(
      hqRouterPasteMatches(
        'Fyi\n  ann:  Can you check the acme invoice export before friday please',
        [card({})]
      )
    ).toHaveLength(1)
  })

  it('does not match short or unrelated text', () => {
    expect(hqRouterPasteMatches('thanks', [card({ text: 'thanks' })])).toEqual([])
    expect(hqRouterPasteMatches('deploy the thing', [card({})])).toEqual([])
  })
})
