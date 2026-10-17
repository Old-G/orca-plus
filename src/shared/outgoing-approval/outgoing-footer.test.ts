import { describe, expect, it } from 'vitest'
import type { OutgoingDraftCall } from './outgoing-action'
import {
  findOutgoingTask,
  outgoingFooter,
  outgoingRef,
  takesOutgoingFooter,
  withOutgoingFooter
} from './outgoing-footer'

function call(service: string, operation: string, editField: string | null = 'message') {
  const value: OutgoingDraftCall = {
    agent: 'claude',
    toolName: 'mcp__claude_ai_Slack__slack_send_message',
    toolInput: {},
    toolUseId: null,
    sessionId: null,
    cwd: null,
    paneKey: null,
    agentSessionId: null,
    service,
    operation,
    editField
  }
  return value
}

describe('outgoing footer', () => {
  it('goes on Slack messages and ClickUp comments only', () => {
    expect(takesOutgoingFooter(call('Slack', 'send message'))).toBe(true)
    expect(takesOutgoingFooter(call('Slack', 'schedule message'))).toBe(true)
    expect(takesOutgoingFooter(call('Slack', 'send message draft'))).toBe(false)
    expect(takesOutgoingFooter(call('ClickUp', 'create comment', 'comment_text'))).toBe(true)
    expect(takesOutgoingFooter(call('git', 'force or delete push', null))).toBe(false)
    expect(takesOutgoingFooter(call('Zoho Desk', 'send reply'))).toBe(false)
  })

  it('finds a linked or named task, the link first', () => {
    expect(findOutgoingTask('see https://app.clickup.com/t/86c1x2y3z, DEV-1')).toEqual({
      id: '86c1x2y3z',
      url: 'https://app.clickup.com/t/86c1x2y3z',
      name: null
    })
    expect(findOutgoingTask(null, 'по DEV-18114 вопрос')).toEqual({
      id: 'DEV-18114',
      url: null,
      name: null
    })
    expect(findOutgoingTask('ISO-8601 и UTF-8')).toBeNull()
  })

  it('names the task, project, chat and ref, and is added once', () => {
    const footer = outgoingFooter({
      task: { id: 'DEV-18114', url: 'https://app.clickup.com/t/9/DEV-18114', name: null },
      project: 'lh_tasks_automatization',
      chatName: 'Ядро lh-agents: статус *и* план',
      ref: outgoingRef('3fa9c1d2-0000-4000-8000-000000000000')
    })
    expect(footer).toBe(
      '↳ [DEV-18114](https://app.clickup.com/t/9/DEV-18114) · lh_tasks_automatization · «Ядро lh-agents: статус и план» · ref 3fa9c1'
    )
    const sent = withOutgoingFooter('Женя, привет\n', footer)
    expect(sent).toBe(`Женя, привет\n\n_${footer}_`)
    expect(withOutgoingFooter(sent, footer)).toBe(sent)
  })

  it('leaves out the task a ClickUp comment is already on', () => {
    expect(
      outgoingFooter(
        {
          task: { id: 'DEV-1', url: null, name: null },
          project: 'hub',
          chatName: null,
          ref: 'abc123'
        },
        'DEV-1'
      )
    ).toBe('↳ hub · ref abc123')
  })
})
