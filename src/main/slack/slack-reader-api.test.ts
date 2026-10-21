import { describe, expect, it, vi } from 'vitest'
import type * as SlackRequestModule from './slack-request'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('./slack-request', async (importOriginal) => ({
  ...(await importOriginal<typeof SlackRequestModule>()),
  slackRequest: requestMock
}))

import { createSlackIntakeApi, slackMessageUrl, slackTextLinks } from './slack-reader-api'

describe('createSlackIntakeApi', () => {
  it('reads only messages the owner marked with 👾, with links, files and permalink', async () => {
    requestMock.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          type: 'message',
          channel: 'D0AAAAAAAAA',
          message: {
            ts: '1792600000.000100',
            user: 'U1',
            text: 'Вот роуты <https://claude.ai/artifact/abc|claude.ai/artifact/abc>',
            permalink: 'https://x.slack.com/archives/D0AAAAAAAAA/p1792600000000100',
            files: [{ name: 'routes.md' }],
            reactions: [{ name: 'space_invader', users: ['UOWNER'] }]
          }
        },
        {
          type: 'message',
          channel: 'C0AAAAAAAAA',
          message: {
            ts: '1792600001.000100',
            user: 'U2',
            text: 'someone else marked this',
            reactions: [{ name: 'space_invader', users: ['U3'] }]
          }
        },
        {
          type: 'message',
          channel: 'C0AAAAAAAAA',
          message: {
            ts: '1792600002.000100',
            user: 'U2',
            text: 'agreed',
            reactions: [{ name: 'heavy_plus_sign', users: ['UOWNER'] }]
          }
        }
      ]
    })
    const api = createSlackIntakeApi('xoxp-1', 'UOWNER', async (id) => `name-${id}`)
    expect(await api.marked()).toEqual([
      {
        channel: 'D0AAAAAAAAA',
        ts: '1792600000.000100',
        threadTs: null,
        author: 'name-U1',
        authorSlackId: 'U1',
        venue: 'dm',
        text: 'Вот роуты claude.ai/artifact/abc (https://claude.ai/artifact/abc)',
        links: ['https://claude.ai/artifact/abc'],
        files: ['routes.md'],
        permalink: 'https://x.slack.com/archives/D0AAAAAAAAA/p1792600000000100',
        at: 1_792_600_000_000
      }
    ])
    expect(requestMock).toHaveBeenCalledWith('xoxp-1', 'reactions.list', { full: true, limit: 100 })
  })

  it('collects each link once', () => {
    expect(slackTextLinks('<https://a.dev/x|x> and <https://a.dev/x> <mailto:a@b.c|a>')).toEqual([
      'https://a.dev/x'
    ])
  })
})

describe('slackMessageUrl', () => {
  it('builds a message link, with the thread for a reply', () => {
    expect(slackMessageUrl('https://acme.slack.com/', 'D1', '1792600000.000100', null)).toBe(
      'https://acme.slack.com/archives/D1/p1792600000000100'
    )
    expect(slackMessageUrl('https://acme.slack.com', 'C1', '2.000200', '1.000100')).toBe(
      'https://acme.slack.com/archives/C1/p2000200?thread_ts=1.000100&cid=C1'
    )
  })
})
