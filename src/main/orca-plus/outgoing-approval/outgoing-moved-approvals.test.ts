import { describe, expect, it } from 'vitest'
import type { PulseDraft } from '../../../shared/pulse-types'
import { MovedApprovals } from './outgoing-moved-approvals'

function draft(
  service: string,
  operation: string,
  body: string,
  chat = 'chat-1',
  target = 'DEV-1'
): PulseDraft {
  return {
    id: 'd2',
    kind: 'clickup-comment',
    target,
    title: `${service} · ${operation}`,
    body,
    project: null,
    personId: null,
    source: 'gate',
    sourceRef: null,
    fingerprint: null,
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    call: {
      agent: 'claude',
      toolName: 'x',
      toolInput: {},
      toolUseId: null,
      sessionId: null,
      cwd: null,
      paneKey: null,
      agentSessionId: chat,
      service,
      operation,
      editField: 'comment_text'
    }
  }
}

const text = 'Петя, эталоны T3-D1 готовы, глянь пожалуйста до пятницы?'
const toTask = {
  agentSessionId: 'chat-1',
  to: 'clickup' as const,
  text,
  taskIds: ['DEV-1', '86abc1234'],
  allowed: { mentions: true, links: [] }
}

describe('MovedApprovals', () => {
  it('lets the moved text through once, from the same chat, to the chosen place', () => {
    const moved = new MovedApprovals(() => 0)
    moved.add({ ...toTask, footer: false })
    expect(moved.take(draft('Slack', 'send message', text))).toBeNull()
    expect(moved.take(draft('ClickUp', 'create comment', text, 'chat-2'))).toBeNull()
    expect(
      moved.take(draft('ClickUp', 'create comment', `[@Петя](#user_mention#1), ${text}`))
    ).toEqual({ footer: false })
    expect(moved.take(draft('ClickUp', 'create comment', text))).toBeNull()
  })

  it('lets it through only to the chosen task, or for Slack only to a DM', () => {
    const moved = new MovedApprovals(() => 0)
    moved.add({ ...toTask, footer: true })
    expect(moved.take(draft('ClickUp', 'create comment', text, 'chat-1', 'DEV-2'))).toBeNull()
    expect(moved.take(draft('ClickUp', 'create comment', text, 'chat-1', '86abc1234'))).toEqual({
      footer: true
    })
    moved.add({
      agentSessionId: 'chat-1',
      to: 'slack',
      text,
      footer: true,
      taskIds: [],
      allowed: { mentions: false, links: [] }
    })
    expect(moved.take(draft('Slack', 'send message', text, 'chat-1', 'C0AAAAAAAAA'))).toBeNull()
    expect(moved.take(draft('Slack', 'send message', text, 'chat-1', 'U0AAAAAAAAA'))).toEqual({
      footer: true
    })
  })

  it('forgets a move after ten minutes', () => {
    let now = 0
    const moved = new MovedApprovals(() => now)
    moved.add({ ...toTask, footer: true })
    now = 11 * 60_000
    expect(moved.take(draft('ClickUp', 'create comment', text))).toBeNull()
  })
})
