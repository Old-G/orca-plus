import { describe, expect, it } from 'vitest'
import {
  hqRouterIgnorePrompt,
  hqRouterNextChat,
  hqRouterNotMine,
  hqRouterSendFirstPrompt
} from './hq-router-send-first'
import { readHqIntake, type HqIntake } from './hq-slack-intake'

describe('router v2 T5: «не моё» and the middle zone prompts', () => {
  it('reads «не моё» on the first line, with or without a reason, and nothing else', () => {
    expect(hqRouterNotMine('не моё: это про DEV-12, у меня T5')).toBe('это про DEV-12, у меня T5')
    expect(hqRouterNotMine('\n  **Не мое** — другой проект\nдальше текст')).toBe('другой проект')
    expect(hqRouterNotMine('«не моё»')).toBe('')
    expect(hqRouterNotMine('Not mine: wrong repo')).toBe('wrong repo')
    expect(hqRouterNotMine('Сверил: моё, беру. Не моё было бы, если…')).toBeNull()
    expect(hqRouterNotMine('не моёшный ответ')).toBeNull()
    expect(hqRouterNotMine(null)).toBeNull()
  })

  it('the chat gets the check-first instruction before the message', () => {
    const prompt = hqRouterSendFirstPrompt('Orca+ · the user sent you a Slack message…')
    expect(prompt.split('\n')[0]).toContain('by itself')
    expect(prompt).toContain('«не моё: <why, in a few words>»')
    expect(prompt.indexOf('не моё')).toBeLessThan(prompt.indexOf('the user sent you'))
  })

  it('the wrong chat is told to ignore it, with what and when', () => {
    const text = hqRouterIgnorePrompt(
      { author: 'Ann', summary: 'Fix the export', text: '', permalink: 'https://x.slack.com/p1' },
      Date.UTC(2026, 10, 28, 9, 5)
    )
    expect(text).toContain('ignore the message')
    expect(text).toContain('2026-11-28 09:05 UTC')
    expect(text).toContain('«Fix the export»')
    expect(text).toContain('Do not act on it')
  })

  it('the runner-up skips the chat that has it and every chat that refused', () => {
    const alts = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }]
    expect(hqRouterNextChat(alts, [], 'x')?.sessionId).toBe('a')
    expect(hqRouterNextChat(alts, [{ chat: 'a' }], 'b')?.sessionId).toBe('c')
    expect(hqRouterNextChat(alts, [{ chat: 'a' }, { chat: 'b' }, { chat: 'c' }], 'x')).toBeNull()
  })

  it('a card keeps where it went and who refused across the bell', () => {
    const card: HqIntake = {
      channel: 'C1',
      ts: '1.000100',
      threadTs: null,
      author: 'Ann',
      authorSlackId: 'U1',
      venue: 'channel',
      text: 'x',
      links: [],
      files: [],
      permalink: null,
      at: 1,
      sent: { chat: 'b', title: 'B', at: 5 },
      notMine: [{ chat: 'a', title: 'A', reason: 'other repo' }],
      repoId: null,
      project: null,
      summary: ''
    }
    const back = readHqIntake(JSON.stringify(card))
    expect(back?.sent).toEqual({ chat: 'b', title: 'B', at: 5 })
    expect(back?.notMine).toEqual([{ chat: 'a', title: 'A', reason: 'other repo' }])
  })
})
