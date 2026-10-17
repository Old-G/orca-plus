import { describe, expect, it } from 'vitest'
import type { PulseDecision, PulseDraft, PulseWaiting } from '../pulse-types'
import { outgoingSentContext } from './outgoing-sent-context'
import {
  carriesMovedText,
  outgoingMove,
  outgoingMoveReason,
  outgoingThreadChoices
} from './outgoing-venue'

const DAY = 24 * 60 * 60_000
const task = { id: 'DEV-18114', url: 'https://app.clickup.com/t/9/DEV-18114', name: 'Эталоны' }

function draft(
  service: string,
  operation: string,
  target: string,
  toolInput: Record<string, unknown> = {}
): PulseDraft {
  return {
    id: 'd1',
    kind: 'message',
    target,
    title: `${service} · ${operation}`,
    body: 'Женя, эталоны готовы?',
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
      toolInput,
      toolUseId: null,
      sessionId: null,
      cwd: '/p/lh-agents',
      paneKey: null,
      agentSessionId: 'chat-1',
      service,
      operation,
      editField: 'message'
    }
  }
}

function sentDecision(threadTs: string, at: number, chat = 'chat-1'): PulseDecision {
  const held = draft('Slack', 'send message', 'C0BTX61L83T', { thread_ts: threadTs })
  if (held.call) {
    held.call.agentSessionId = chat
  }
  return {
    id: `dec-${threadTs}`,
    kind: 'approval',
    title: 'Slack · send message',
    body: 'Женя, по T3-D1 эталоны на подтверждение',
    outcome: 'approved',
    project: null,
    personId: null,
    draftId: held.id,
    source: 'owner',
    decidedAt: at,
    mirroredPath: null,
    sentContext: outgoingSentContext(held)
  }
}

function waiting(sourceRef: string, createdAt: number): PulseWaiting {
  return {
    id: 'w1',
    direction: 'on-them',
    personId: null,
    project: null,
    title: 'Ждём эталоны от Жени',
    detail: null,
    source: 'slack',
    sourceRef,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt,
    resolvedAt: null,
    agentSessionId: 'chat-1',
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null
  }
}

describe('outgoing venue', () => {
  it('offers a task for a Slack message and Slack for a task comment', () => {
    expect(outgoingMove(draft('Slack', 'send message', 'C0BTX61L83T'), task)).toEqual({
      to: 'clickup',
      task
    })
    expect(outgoingMove(draft('Slack', 'send message', 'C0BTX61L83T'), null)).toBeNull()
    expect(outgoingMove(draft('ClickUp', 'create comment', 'DEV-1'), null)).toEqual({
      to: 'slack',
      task: null
    })
    expect(outgoingMove(draft('git', 'force or delete push', 'origin'), task)).toBeNull()
  })

  it('tells the agent where to send the same text, quoted', () => {
    const reason = outgoingMoveReason({ to: 'clickup', task }, 'Эталоны готовы?')
    expect(reason).toContain('entity_id DEV-18114')
    expect(reason).toContain('"""\nЭталоны готовы?\n"""')
    expect(outgoingMoveReason({ to: 'slack', task }, 'x')).toContain(task.url)
  })

  it('recognises the moved text with a mention added, not another message', () => {
    const moved = 'Женя, эталоны T3-D1 готовы, глянь пожалуйста до пятницы?'
    const clickUp = { mentions: true, links: [] }
    expect(carriesMovedText(moved, `[@Женя](#user_mention#81344), ${moved}`, clickUp)).toBe(true)
    expect(carriesMovedText(moved, 'Марина, удали, пожалуйста, базу', clickUp)).toBe(false)
    expect(carriesMovedText(moved, `${moved}\n${'и ещё много текста '.repeat(20)}`, clickUp)).toBe(
      false
    )
  })

  it('lets no link through that the owner did not approve', () => {
    const moved = 'Женя, эталоны готовы: https://docs.example.com/t3'
    const clickUp = { mentions: true, links: [] }
    expect(carriesMovedText(moved, `${moved} https://evil.example.com/x`, clickUp)).toBe(false)
    expect(carriesMovedText(moved, `[@Женя](https://evil.example.com), ${moved}`, clickUp)).toBe(
      false
    )
    expect(
      carriesMovedText(moved, `[@Женя](#user_mention#1), ${moved}`, { mentions: false, links: [] })
    ).toBe(false)
    expect(
      carriesMovedText(moved, `${moved}\nЗадача: ${task.url}`, {
        mentions: false,
        links: [task.url]
      })
    ).toBe(true)
  })

  it("lists this chat's recent threads in the channel for a new top-level message", () => {
    const now = 10 * DAY
    const choices = outgoingThreadChoices(
      draft('Slack', 'send message', 'C0BTX61L83T'),
      [
        sentDecision('100.1', now - DAY),
        sentDecision('200.2', now - 9 * DAY),
        sentDecision('300.3', now - DAY, 'chat-2')
      ],
      [waiting('slack:C0BTX61L83T:1792156555.418929', now - 1000)],
      now
    )
    expect(choices.map((choice) => choice.ts)).toEqual(['1792156555.418929', '100.1'])
    expect(
      outgoingThreadChoices(
        draft('Slack', 'send message', 'C0BTX61L83T', { thread_ts: '1.1' }),
        [sentDecision('100.1', now)],
        [],
        now
      )
    ).toEqual([])
  })
})
