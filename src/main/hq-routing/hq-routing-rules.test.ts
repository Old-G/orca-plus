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
ci.failed:
  - do: send_to_pushing_session
`)
    expect(routing.findings).toEqual([])
    expect(routing.problems).toEqual([
      'ci.failed: Orca+ does not act on this kind yet',
      'review.finding[0]: when.sev takes P0…P3',
      'review.finding[1]: at takes HH:MM'
    ])
    expect(parseHqRouting(null)).toMatchObject({
      findings: [],
      minFreePercent: HQ_ROUTING_DEFAULT_MIN_FREE
    })
  })

  // Custom build (hq-plus-person-replies)
  it('reads the trust ladder and refuses a step that is not one', () => {
    const routing = parseHqRouting(
      'ladder:\n  bell:hq-intake: 1\n  slack-send-message: { step: 2, allow_people: true }\n  odd: 7\n'
    )
    expect(routing.ladder).toEqual({
      'bell:hq-intake': { step: 1, allowPeople: false },
      'slack-send-message': { step: 2, allowPeople: true }
    })
    expect(routing.problems).toEqual(['ladder.odd: a step is 0, 1, 2 or 3'])
  })

  it('reads the answers rule, and an unreadable one leaves every answer a card', () => {
    expect(
      parseHqRouting('person.reply:\n  - do: send_to_asking_session\n    since: 2026-10-24\n')
        .replies
    ).toEqual({ do: 'send_to_asking_session', since: new Date(2026, 9, 24).getTime() })
    const broken = parseHqRouting('person.reply:\n  - do: forward_everything\n')
    expect(broken.replies).toBeNull()
    expect(broken.problems).toEqual(['person.reply[0]: do takes send_to_asking_session or card'])
    expect(parseHqRouting('min_free: 10\n').replies).toBeNull()
  })
})
