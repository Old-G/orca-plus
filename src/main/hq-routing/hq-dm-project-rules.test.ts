import { describe, expect, it } from 'vitest'
import { resolveHqDmProjectRules } from './hq-dm-project-rules'

describe('resolveHqDmProjectRules', () => {
  it('finds people by name or Slack id, first rule first, and names the ones it cannot place', () => {
    const people = [
      { name: 'Ann Lee', slackUserId: 'U_ANN' },
      { name: 'Bob', slackUserId: 'U_BOB' },
      { name: 'Cid', slackUserId: null }
    ]
    expect(
      resolveHqDmProjectRules(
        [
          { people: ['ann lee', 'U_BOB', 'Cid', 'Dee'], project: 'HQ' },
          { people: ['Bob'], project: 'hub' }
        ],
        people
      )
    ).toEqual({
      rules: [
        { slackUserId: 'U_ANN', project: 'HQ' },
        { slackUserId: 'U_BOB', project: 'HQ' }
      ],
      unknown: ['Cid', 'Dee']
    })
  })
})
