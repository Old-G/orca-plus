import { describe, expect, it } from 'vitest'
import { countHqPlanSteps, parseHqPlusConfig } from './hq-plus-screen-stats'

const PLAN = [
  '# Plan',
  '## Stage 16',
  '- [x] **16.1 Old step.**',
  '## Stage 17. Kite',
  '- [x] **17.1 Journal.** done',
  '  - Check: nested note',
  '- [ ] **17.2 Screen.** next',
  '- [ ] **17.3 River.**',
  '### Notes',
  '- [x] **17.x side note**',
  '## Stage 18',
  '- [ ] **18.1 Later.**'
].join('\n')

describe('countHqPlanSteps', () => {
  it('counts the steps of one section, sub-headings included, and names the first open one', () => {
    expect(countHqPlanSteps(PLAN, 'Stage 17')).toEqual({ done: 2, total: 4, next: '17.2 Screen' })
  })

  it('is null when the section has no steps', () => {
    expect(countHqPlanSteps(PLAN, 'Stage 99')).toBeNull()
  })
})

describe('parseHqPlusConfig', () => {
  it('reads the plan path and the section, quotes and comments aside', () => {
    expect(parseHqPlusConfig('plan: plans/acme.md  # the plan\nsection: "Stage 17"\n')).toEqual({
      plan: 'plans/acme.md',
      section: 'Stage 17'
    })
    expect(parseHqPlusConfig('')).toEqual({ plan: null, section: null })
  })
})
