import { describe, expect, it } from 'vitest'
import { HQ_ROUTING_DEFAULT_MIN_FREE } from '../../shared/hq-routing'
import { hqFindingRuleFor, parseHqRouting } from './hq-routing-rules'

const FILE = `
review.finding:
  - when: {sev: [P0, P1]}
    at: "19:00"
    do: open_session
    since: 2026-10-24
    never: prod
  - when: {sev: [P2]}
    do: collect
min_free: 30
`

describe('routing.yaml', () => {
  it('reads the Codex rules, their hour and the day they start', () => {
    const routing = parseHqRouting(FILE)
    expect(routing.problems).toEqual([])
    expect(routing.minFreePercent).toBe(30)
    expect(hqFindingRuleFor(routing, 1)).toEqual({
      sev: [0, 1],
      atMinute: 19 * 60,
      do: 'open_session',
      since: new Date(2026, 9, 24).getTime()
    })
    expect(hqFindingRuleFor(routing, 2)?.do).toBe('collect')
    expect(hqFindingRuleFor(routing, 3)).toBeNull()
  })

  it('acts on nothing it cannot read, and says what it skipped', () => {
    expect(parseHqRouting('review.finding: [oops').findings).toEqual([])
    const routing = parseHqRouting(`
review.finding:
  - when: {sev: [P9]}
    do: open_session
  - when: {sev: P1}
    at: "7pm"
    do: open_session
person.reply:
  - do: send_to_asking_session
`)
    expect(routing.findings).toEqual([])
    expect(routing.problems).toEqual([
      'person.reply: Orca+ does not act on this kind yet',
      'review.finding[0]: when.sev takes P0…P3',
      'review.finding[1]: at takes HH:MM'
    ])
    expect(parseHqRouting(null)).toMatchObject({
      findings: [],
      minFreePercent: HQ_ROUTING_DEFAULT_MIN_FREE
    })
  })
})
