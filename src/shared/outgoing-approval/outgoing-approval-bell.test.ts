import { describe, expect, it } from 'vitest'
import type { PulseDraft } from '../pulse-types'
import {
  outgoingApprovalBellItem,
  outgoingApprovalHead,
  outgoingApprovalHeadProject
} from './outgoing-approval-bell'

function slackDraft(toolInput: Record<string, unknown>): PulseDraft {
  return {
    id: 'd1',
    kind: 'message',
    target: 'C0AAAAAAAAA',
    title: 'Slack · send message',
    body: 'Лиза, разобрался.',
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
      cwd: '/Users/me/Projects/acme-hub',
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
    const draft = slackDraft({ channel_id: 'C0AAAAAAAAA', thread_ts: '1.2', message: 'x' })
    expect(
      outgoingApprovalHead(draft, {
        targetName: '#acme-hub-context',
        replyingTo: 'Лиза: «Почему не переезжает?»',
        chatName: 'Docs Hub: переезд'
      })
    ).toBe(
      'Slack · send message → #acme-hub-context · in a thread, replying to Лиза: «Почему не переезжает?» · from «Docs Hub: переезд» (acme-hub)'
    )
  })

  it('falls back to the raw target and the project when nothing could be named', () => {
    expect(outgoingApprovalHead(slackDraft({ channel_id: 'C0AAAAAAAAA', message: 'x' }))).toBe(
      'Slack · send message → C0AAAAAAAAA · from acme-hub'
    )
  })
})

describe('outgoingApprovalBellItem', () => {
  it('keeps the head on the first line and the whole text after it', () => {
    const item = outgoingApprovalBellItem(slackDraft({ channel_id: 'C1', message: 'x' }), {
      targetName: '#general'
    })
    expect(item.body).toBe('Slack · send message → #general · from acme-hub\nЛиза, разобрался.')
  })
})

describe('outgoingApprovalHeadProject', () => {
  it('reads the project from either form of the «from» part', () => {
    expect(
      outgoingApprovalHeadProject('Slack message → #it · in a thread · from «Fix» (acme-api)')
    ).toBe('acme-api')
    expect(outgoingApprovalHeadProject('ClickUp comment · from acme-flows')).toBe('acme-flows')
    expect(outgoingApprovalHeadProject('Slack message → Петя · from «Ask HQ»')).toBeNull()
    expect(outgoingApprovalHeadProject('Slack message → Петя')).toBeNull()
  })
})
