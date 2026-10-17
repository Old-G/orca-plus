import { describe, expect, it } from 'vitest'
import { outgoingSentContext } from '../../shared/outgoing-approval/outgoing-sent-context'
import type { PulseDecision, PulseDraft, PulseWaiting } from '../../shared/pulse-types'
import { buildHqScoutContext } from './hq-scout-context'

const NOW = Date.parse('2026-10-17T12:00:00Z')
const DAY = 24 * 60 * 60_000

const draft: PulseDraft = {
  id: 'd1',
  kind: 'message',
  target: 'C0AAAAAAAAA',
  title: 'Slack · send message',
  body: 'Петя, эталоны готовы?',
  project: null,
  personId: null,
  source: 'gate',
  sourceRef: null,
  fingerprint: null,
  status: 'sent',
  createdAt: 1,
  updatedAt: 1,
  call: {
    agent: 'claude',
    toolName: 'mcp__claude_ai_Slack__slack_send_message',
    toolInput: { channel_id: 'C0AAAAAAAAA', message: 'x', thread_ts: '1792156555.418929' },
    toolUseId: null,
    sessionId: null,
    cwd: '/p/acme-agents',
    paneKey: null,
    agentSessionId: 'chat-1',
    service: 'Slack',
    operation: 'send message',
    editField: 'message'
  }
}

function decision(at: number, outcome: PulseDecision['outcome'] = 'approved'): PulseDecision {
  return {
    id: `dec-${at}`,
    kind: 'approval',
    title: 'Slack · send message',
    body: 'Петя, эталоны\nготовы?',
    outcome,
    project: null,
    personId: null,
    draftId: 'd1',
    source: 'owner',
    decidedAt: at,
    mirroredPath: null,
    sentContext: outgoingSentContext(draft, {
      targetName: '#acme-hub',
      chatName: 'Ядро acme-agents',
      task: { id: 'DEV-18114', url: null, name: null }
    })
  }
}

describe('buildHqScoutContext', () => {
  it('lists whom the chats wait for and what went out in the last three days', () => {
    const waiting = {
      id: 'w1',
      direction: 'on-them',
      personId: 'p1',
      title: 'Эталоны от Пети',
      source: 'slack',
      sourceRef: 'slack:C0AAAAAAAAA:1792156555.418929',
      status: 'open',
      createdAt: NOW - DAY
    } satisfies Partial<PulseWaiting>
    const context = buildHqScoutContext(
      [{ ...emptyWaiting(), ...waiting }],
      [decision(NOW - DAY), decision(NOW - 5 * DAY), decision(NOW - DAY, 'rejected')],
      (id) => (id === 'p1' ? 'Петя' : null),
      NOW
    )
    expect(context.waitings).toEqual([
      {
        person: 'Петя',
        title: 'Эталоны от Пети',
        source: 'slack',
        sourceRef: 'slack:C0AAAAAAAAA:1792156555.418929',
        since: new Date(NOW - DAY).toISOString()
      }
    ])
    expect(context.sent).toEqual([
      {
        at: new Date(NOW - DAY).toISOString(),
        to: '#acme-hub',
        inThread: true,
        task: 'DEV-18114',
        chat: 'Ядро acme-agents',
        project: 'acme-agents',
        text: 'Петя, эталоны готовы?'
      }
    ])
  })
})

function emptyWaiting(): PulseWaiting {
  return {
    id: '',
    direction: 'on-them',
    personId: null,
    project: null,
    title: '',
    detail: null,
    source: '',
    sourceRef: null,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: 0,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null
  }
}
