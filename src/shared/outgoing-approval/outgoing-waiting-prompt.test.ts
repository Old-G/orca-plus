import { describe, expect, it } from 'vitest'
import type { OutgoingDraftCall } from './outgoing-action'
import { outgoingWaitingFollowUp } from './outgoing-waiting-prompt'

function call(toolInput: Record<string, unknown>): OutgoingDraftCall {
  return {
    agent: 'claude',
    toolName: 'mcp__claude_ai_Slack__slack_send_message',
    toolInput,
    toolUseId: 't1',
    sessionId: 's1',
    cwd: '/repo',
    paneKey: null,
    agentSessionId: 'chat-1',
    service: 'Slack',
    operation: 'send message',
    editField: 'message'
  }
}

describe('outgoingWaitingFollowUp', () => {
  it('sends a DM addressed by user id to the tool result for its D… channel', () => {
    const text = outgoingWaitingFollowUp(call({ channel_id: 'U0AAAAAAAAA' }), 'U0AAAAAAAAA')
    expect(text).toContain('Take the channel id and the message ts from the tool result.')
    expect(text).not.toContain('slack:U0AAAAAAAAA')
  })

  it('spells out the thread a reply waits in', () => {
    const text = outgoingWaitingFollowUp(
      call({ channel_id: 'C0AAAAAAAAA', thread_ts: '1792184213.178000' }),
      'C0AAAAAAAAA'
    )
    expect(text).toContain('--source-ref "slack:C0AAAAAAAAA:1792184213.178000"')
  })

  it('says nothing for other services', () => {
    expect(outgoingWaitingFollowUp({ ...call({}), service: 'Gmail' }, 'a@b.c')).toBeNull()
  })
})
