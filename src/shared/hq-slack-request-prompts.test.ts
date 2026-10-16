import { describe, expect, it } from 'vitest'
import { hqSlackReplyPrompt, hqSlackThread } from './hq-slack-request-prompts'

describe('Slack request prompts', () => {
  it('reads the thread from the request id, and a follow-up id to its root', () => {
    expect(
      hqSlackThread({ id: 'C1:1.2', permalink: 'https://lev.slack.com/archives/C1/p12' })
    ).toEqual({
      channelId: 'C1',
      threadTs: '1.2',
      permalink: 'https://lev.slack.com/archives/C1/p12'
    })
    expect(hqSlackThread({ id: 'C1:1.2:3.4', permalink: '' })?.threadTs).toBe('1.2')
    expect(hqSlackThread({ id: 'TEST:1', permalink: '' })).toBeNull()
  })

  it('drops a link that is not Slack, and the reply prompt carries only the address', () => {
    const thread = hqSlackThread({ id: 'C1:1.2', permalink: 'https://evil.example/x' })
    expect(thread?.permalink).toBe('')
    const prompt = hqSlackReplyPrompt(thread!)
    expect(prompt).toContain('channel_id C1, thread_ts 1.2')
    expect(prompt).toContain('Approve')
    expect(prompt).not.toContain('evil')
    expect(prompt).not.toContain('Тон Глеба')
  })

  it("points a reply at the owner's tone guide and his past edits when HQ is set", () => {
    const prompt = hqSlackReplyPrompt(hqSlackThread({ id: 'C1:1.2', permalink: '' })!, {
      tonePath: '/hq/wiki/tone.md',
      correctionsPath: '/hq/slack-scout/corrections.jsonl'
    })
    expect(prompt).toContain('Тон Глеба описан в /hq/wiki/tone.md')
    expect(prompt).toContain('/hq/slack-scout/corrections.jsonl (draft → sent)')
  })
})
