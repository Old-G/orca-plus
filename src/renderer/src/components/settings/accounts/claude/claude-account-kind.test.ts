import { describe, expect, it } from 'vitest'
import { claudeAccountKind } from './claude-account-kind'

describe('claude account kind', () => {
  it('tells a personal plan from a team by the organization name', () => {
    expect(
      claudeAccountKind({
        email: 'ann@acme.example',
        organizationName: "ann@acme.example's Organization"
      })
    ).toEqual({ title: 'Personal', kind: 'personal' })
    expect(claudeAccountKind({ email: 'ann@acme.example', organizationName: 'Acme' })).toEqual({
      title: 'Acme',
      kind: 'team'
    })
    expect(claudeAccountKind({ email: 'ann@acme.example', organizationName: null })).toEqual({
      title: 'ann@acme.example',
      kind: null
    })
  })
})
