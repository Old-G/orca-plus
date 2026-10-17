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
      cwd: '/p/lh-it-hub',
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
        channelName: 'DM Марина',
        author: 'Марина',
        title: 'Прогон не переезжает',
        ask: 'Почему прогон 660 не переезжает в хаб, хотя я всё сделала по инструкции?'
      }
    ]
  }),
  JSON.stringify({
    'C9:2.2': { decision: 'answered', at: 1, author: 'Женя', title: 'Когда релиз' }
  })
)

function sources(
  names: Record<string, string> = {},
  more: Partial<OutgoingContextSources> = {}
): OutgoingContextSources {
  return {
    slackName: async (id) => names[id] ?? null,
    scout: async () => scout,
    chatName: (id) => (id === 'claude_1' ? 'Hub Context: переезд' : null),
    lastTask: () => null,
    clickUpTask: async () => null,
    ...more
  }
}

describe('describeOutgoingDraft', () => {
  it('names a channel through Slack and the chat that sends to it', async () => {
    expect(
      await describeOutgoingDraft(draft('C0BTX61L83T', {}), sources({ C0BTX61L83T: '#it-hub' }))
    ).toEqual({
      chatName: 'Hub Context: переезд',
      task: null,
      targetName: '#it-hub',
      replyingTo: null
    })
  })

  it('falls back to the scout for a DM the bot cannot see, with the message the thread answers', async () => {
    const context = await describeOutgoingDraft(draft('D1', { thread_ts: '1.1' }), sources())
    expect(context.targetName).toBe('DM Марина')
    expect(context.replyingTo).toBe(
      'Марина: «Почему прогон 660 не переезжает в хаб, хотя я всё сделала по инструкции?»'
    )
  })

  it('reads a decided request for the thread when its draft is gone', async () => {
    const context = await describeOutgoingDraft(draft('C9', { thread_ts: '2.2' }), sources())
    expect(context).toMatchObject({ targetName: null, replyingTo: 'Женя: «Когда релиз»' })
  })

  it('names nothing but the chat for a call that is not Slack', async () => {
    expect(await describeOutgoingDraft(draft('86abc', {}, 'ClickUp'), sources())).toEqual({
      chatName: 'Hub Context: переезд',
      task: null
    })
  })

  it('finds the task a message names and asks ClickUp for its link and name', async () => {
    const message = { ...draft('C1', {}), body: 'Женя, по DEV-18114: эталоны готовы?' }
    const context = await describeOutgoingDraft(
      message,
      sources(
        {},
        {
          clickUpTask: async (id) =>
            id === 'DEV-18114'
              ? { id, url: 'https://app.clickup.com/t/9/DEV-18114', name: 'T3-D1 эталоны' }
              : null
        }
      )
    )
    expect(context.task).toEqual({
      id: 'DEV-18114',
      url: 'https://app.clickup.com/t/9/DEV-18114',
      name: 'T3-D1 эталоны'
    })
  })

  it("keeps to the chat's last task when the message names none, and a comment to its own task", async () => {
    const last = { id: 'DEV-7', url: 'https://app.clickup.com/t/9/DEV-7', name: 'Seven' }
    expect(
      (await describeOutgoingDraft(draft('C1', {}), sources({}, { lastTask: () => last }))).task
    ).toEqual(last)
    const comment = draft('DEV-8', {}, 'ClickUp')
    if (comment.call) {
      comment.call.operation = 'create comment'
    }
    expect(
      (await describeOutgoingDraft(comment, sources({}, { lastTask: () => last }))).task?.id
    ).toBe('DEV-8')
  })
})
