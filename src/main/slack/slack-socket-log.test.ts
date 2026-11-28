import { describe, expect, it, vi } from 'vitest'

vi.mock('../observability/logs-directory', () => ({ getLogsDirectory: () => '/nonexistent' }))

import { slackReactionLogLine } from './slack-socket-log'

const push = { user: 'U1', reaction: 'space_invader', channel: 'C1', ts: '1.0', at: 10_000 }

describe('slackReactionLogLine', () => {
  it('says whose reaction it was and how late it came, without the message', () => {
    expect(slackReactionLogLine(push, 'U1', 10_420)).toBe(
      'reaction :space_invader: by owner, 420 ms after'
    )
    expect(slackReactionLogLine({ ...push, user: 'U2' }, 'U1', 10_000)).toBe(
      'reaction :space_invader: by someone else, 0 ms after'
    )
  })

  it('copes with no event time, no owner and a clock behind Slack', () => {
    expect(slackReactionLogLine({ ...push, at: null }, null, 0)).toBe(
      'reaction :space_invader: by someone else, no event time'
    )
    expect(slackReactionLogLine(push, 'U1', 9_000)).toBe(
      'reaction :space_invader: by owner, 0 ms after'
    )
  })
})
