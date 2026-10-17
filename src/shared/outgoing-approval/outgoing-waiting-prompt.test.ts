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
    const text = outgoingWaitingFollowUp(call({ channel_id: 'U097YTWNSLC' }), 'U097YTWNSLC')
    expect(text).toContain('Take the channel id and the message ts from the tool result.')
    expect(text).not.toContain('slack:U097YTWNSLC')
  })

  it('spells out the thread a reply waits in', () => {
    const text = outgoingWaitingFollowUp(
      call({ channel_id: 'C0BTX61L83T', thread_ts: '1792184213.178000' }),
      'C0BTX61L83T'
    )
    expect(text).toContain('--source-ref "slack:C0BTX61L83T:1792184213.178000"')
  })

  it('asks to wait on a ClickUp comment by its task and new comment id', () => {
    const text = outgoingWaitingFollowUp(
      { ...call({}), service: 'ClickUp', operation: 'create comment', editField: 'comment_text' },
      'DEV-18114'
    )
    expect(text).toContain('--source clickup')
    expect(text).toContain(
      `--source-ref "clickup:DEV-18114:<the new comment's id from the tool result>"`
    )
  })

  it('says nothing for other services', () => {
    expect(outgoingWaitingFollowUp({ ...call({}), service: 'Gmail' }, 'a@b.c')).toBeNull()
  })
})
