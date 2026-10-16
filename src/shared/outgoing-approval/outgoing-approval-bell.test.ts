import { describe, expect, it } from 'vitest'
import type { PulseDraft } from '../pulse-types'
import { outgoingApprovalBellItem, outgoingApprovalHead } from './outgoing-approval-bell'

function slackDraft(toolInput: Record<string, unknown>): PulseDraft {
  return {
    id: 'd1',
    kind: 'message',
    target: 'C0BTX61L83T',
    title: 'Slack · send message',
    body: 'Марина, разобрался.',
    project: null,
    personId: null,
    source: 'outgoing-gate',
    sourceRef: null,
    fingerprint: null,
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    call: {
      agent: 'claude',
      toolName: 'mcp__claude_ai_Slack__slack_send_message',
      toolInput,
      toolUseId: null,
      sessionId: null,
      cwd: '/Users/me/Projects/lh-it-hub',
      paneKey: null,
      agentSessionId: 'claude_1',
      service: 'Slack',
      operation: 'send message',
      editField: 'message'
    }
  }
}

describe('outgoingApprovalHead', () => {
  it('names the channel, the thread it answers and the chat that sends it', () => {
    const draft = slackDraft({ channel_id: 'C0BTX61L83T', thread_ts: '1.2', message: 'x' })
    expect(
      outgoingApprovalHead(draft, {
        targetName: '#it-hub-context',
        replyingTo: 'Марина: «Почему не переезжает?»',
        chatName: 'Hub Context: переезд'
      })
    ).toBe(
      'Slack · send message → #it-hub-context · in a thread, replying to Марина: «Почему не переезжает?» · from «Hub Context: переезд» (lh-it-hub)'
    )
  })

  it('falls back to the raw target and the project when nothing could be named', () => {
    expect(outgoingApprovalHead(slackDraft({ channel_id: 'C0BTX61L83T', message: 'x' }))).toBe(
      'Slack · send message → C0BTX61L83T · from lh-it-hub'
    )
  })
})

describe('outgoingApprovalBellItem', () => {
  it('keeps the head on the first line and the whole text after it', () => {
    const item = outgoingApprovalBellItem(slackDraft({ channel_id: 'C1', message: 'x' }), {
      targetName: '#general'
    })
    expect(item.body).toBe('Slack · send message → #general · from lh-it-hub\nМарина, разобрался.')
  })
})
