import { describe, expect, it } from 'vitest'
import { readCliAgentLaunch } from './agent-launch-request'
import { HQ_CHAT_ROLE_SESSION_OPTION } from '../../shared/hq-chat-role'

const read = (flags: Record<string, string>, createsWorktree = false) =>
  readCliAgentLaunch(new Map(Object.entries(flags)), 'claude', { createsWorktree })

describe('orca agent launch --role (hq-chat-roles)', () => {
  it('carries the role to the host in the launch options, for both launch commands', () => {
    expect(read({ role: 'worker' }).sessionOptions).toEqual({
      [HQ_CHAT_ROLE_SESSION_OPTION]: 'worker'
    })
    expect(read({ role: 'lead' }, true).sessionOptions).toEqual({
      [HQ_CHAT_ROLE_SESSION_OPTION]: 'lead'
    })
  })

  it('sends no options without a role or a model', () => {
    expect(read({}).sessionOptions).toBeUndefined()
  })

  it('refuses a role it does not know', () => {
    expect(() => read({ role: 'boss' })).toThrow(
      /--role must be one of: lead, sublead, worker, review/
    )
  })

  it('refuses a role for a terminal, which keeps no role', () => {
    expect(() => read({ role: 'worker', surface: 'terminal' })).toThrow(/--role needs a chat/)
  })
})
