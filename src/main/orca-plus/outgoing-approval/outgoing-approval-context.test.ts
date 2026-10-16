import { describe, expect, it } from 'vitest'
import { indexHqSlackScout } from '../../hq-today/hq-slack-scout-index'
import type { PulseDraft } from '../../../shared/pulse-types'
import { describeOutgoingDraft, type OutgoingContextSources } from './outgoing-approval-context'

function draft(
  target: string | null,
  toolInput: Record<string, unknown>,
  service = 'Slack'
): PulseDraft {
  return {
    id: 'd1',
    kind: 'message',
    target,
    title: `${service} · send message`,
    body: 'text',
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
      cwd: '/p/acme-hub',
      paneKey: null,
      agentSessionId: 'claude_1',
      service,
      operation: 'send message',
      editField: 'message'
    }
  }
}

const scout = indexHqSlackScout(
  JSON.stringify({
    drafts: [
      {
        id: 'D1:1.1',
        channelName: 'DM Лиза',
        author: 'Лиза',
        title: 'Прогон не переезжает',
        ask: 'Почему прогон 660 не переезжает в хаб, хотя я всё сделала по инструкции?'
      }
    ]
  }),
  JSON.stringify({
    'C9:2.2': { decision: 'answered', at: 1, author: 'Петя', title: 'Когда релиз' }
  })
)

function sources(names: Record<string, string> = {}): OutgoingContextSources {
  return {
    slackName: async (id) => names[id] ?? null,
    scout: async () => scout,
    chatName: (id) => (id === 'claude_1' ? 'Docs Hub: переезд' : null)
  }
}

describe('describeOutgoingDraft', () => {
  it('names a channel through Slack and the chat that sends to it', async () => {
    expect(
      await describeOutgoingDraft(draft('C0AAAAAAAAA', {}), sources({ C0AAAAAAAAA: '#acme-hub' }))
    ).toEqual({ chatName: 'Docs Hub: переезд', targetName: '#acme-hub', replyingTo: null })
  })

  it('falls back to the scout for a DM the bot cannot see, with the message the thread answers', async () => {
    const context = await describeOutgoingDraft(draft('D1', { thread_ts: '1.1' }), sources())
    expect(context.targetName).toBe('DM Лиза')
    expect(context.replyingTo).toBe(
      'Лиза: «Почему прогон 660 не переезжает в хаб, хотя я всё сделала по инструкции?»'
    )
  })

  it('reads a decided request for the thread when its draft is gone', async () => {
    const context = await describeOutgoingDraft(draft('C9', { thread_ts: '2.2' }), sources())
    expect(context).toMatchObject({ targetName: null, replyingTo: 'Петя: «Когда релиз»' })
  })

  it('names nothing but the chat for a call that is not Slack', async () => {
    expect(await describeOutgoingDraft(draft('86abc', {}, 'ClickUp'), sources())).toEqual({
      chatName: 'Docs Hub: переезд'
    })
  })
})
