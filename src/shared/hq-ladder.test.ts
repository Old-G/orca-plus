import { describe, expect, it } from 'vitest'
import {
  hqApprovalKind,
  hqLadderStats,
  hqOwnerDecisionSource,
  readHqOwnerDecisionSource,
  type HqLadderDecision,
  type HqLadderOutcome
} from './hq-ladder'

const many = (kind: string, outcomes: HqLadderOutcome[]): HqLadderDecision[] =>
  outcomes.map((outcome, index) => ({ kind, outcome, at: index }))

describe('trust ladder', () => {
  it('reads back the kind and outcome a decision row was written with', () => {
    const source = hqOwnerDecisionSource('bell:hq-intake', 'rejected')
    expect(readHqOwnerDecisionSource(source)).toEqual({
      kind: 'bell:hq-intake',
      outcome: 'rejected'
    })
    expect(readHqOwnerDecisionSource('approve-gate')).toBe(null)
    expect(hqApprovalKind('Slack · send message')).toBe('slack-send-message')
  })

  it('offers step 1 after 20 cases at 90%, and holds a message to people at step 1', () => {
    const intake = many('bell:hq-intake', [...Array(19).fill('accepted'), 'edited'])
    const slack = many('slack-send-message', Array(50).fill('accepted'))
    const stats = hqLadderStats([...intake, ...slack], {
      'slack-send-message': { step: 1, allowPeople: false }
    })
    expect(stats.find((row) => row.kind === 'bell:hq-intake')?.proposal).toEqual({
      to: 1,
      why: '≥20 cases, ≥90% as offered'
    })
    const held = stats.find((row) => row.kind === 'slack-send-message')
    expect(held?.proposal).toBe(null)
    expect(held?.held).toMatch(/message to people/)
  })

  it('steps down after two changes in a row', () => {
    const stats = hqLadderStats(many('clickup-move', ['accepted', 'edited', 'rejected']), {
      'clickup-move': { step: 2, allowPeople: false }
    })
    expect(stats[0].proposal).toEqual({ to: 1, why: 'two changes or refusals in a row' })
  })
})
