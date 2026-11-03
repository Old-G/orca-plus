import { describe, expect, it } from 'vitest'
import {
  checkHqInWorkChats,
  findHqInWorkChat,
  hqInWorkChatPrompt,
  hqInWorkQueries,
  parseHqInWorkChatAnswer,
  type HqInWorkSearch
} from './hq-in-work'

// Custom build (hq-in-work, owner 03.11): plan stage 20.11.
describe('hqInWorkQueries', () => {
  it('takes the permalink, the tasks and two long sentences cut to eight words', () => {
    const queries = hqInWorkQueries('slack:C0ACME:1700000000.000100', [
      'Hi all. From the 16th the agent drafts a spec for every change request in the channel.\n' +
        'Owners review drafts within three working days, see DEV-18611.',
      'ok'
    ])
    expect(queries).toEqual([
      'p1700000000000100',
      'DEV-18611',
      'From the 16th the agent drafts a spec',
      'Owners review drafts within three working days see'
    ])
  })
})

describe('findHqInWorkChat', () => {
  const since = Date.parse('2026-11-02T22:00:00Z')
  const open = new Set(['claude_specs', 'claude_later'])

  it('takes the open chat that held a query first after the message', async () => {
    const search: HqInWorkSearch = async (query) =>
      query === 'p1'
        ? {
            exact: true,
            hits: [
              { chatSessionId: 'claude_later', at: '2026-11-03T08:00:00Z', role: 'user' },
              { chatSessionId: 'claude_specs', at: '2026-11-02T22:15:00Z', role: 'user' },
              { chatSessionId: null, at: '2026-11-02T22:04:00Z', role: 'user' }
            ]
          }
        : { exact: true, hits: [] }
    expect(await findHqInWorkChat(['p1', 'DEV-1'], since, open, search)).toEqual({
      sessionId: 'claude_specs',
      query: 'p1'
    })
  })

  it('ignores some-of-the-words matches, closed chats and lines before the message', async () => {
    const search: HqInWorkSearch = async (query) => ({
      exact: query !== 'loose',
      hits: [
        {
          chatSessionId: query === 'loose' ? 'claude_specs' : 'claude_closed',
          at: '2026-11-03T01:00:00Z',
          role: 'user'
        },
        { chatSessionId: 'claude_specs', at: '2026-11-02T21:00:00Z', role: 'user' }
      ]
    })
    expect(await findHqInWorkChat(['loose', 'exact'], since, open, search)).toBeNull()
  })

  it('a chat that only read or discussed the message is not doing it', async () => {
    const search: HqInWorkSearch = async () => ({
      exact: true,
      hits: [
        { chatSessionId: 'claude_specs', at: '2026-11-03T07:51:00Z', role: 'tool' },
        { chatSessionId: 'claude_later', at: '2026-11-03T08:00:00Z', role: 'assistant' }
      ]
    })
    expect(await findHqInWorkChat(['p1'], since, open, search)).toBeNull()
  })

  it('a failing search finds nothing rather than throwing', async () => {
    const search: HqInWorkSearch = () => Promise.reject(new Error('index closed'))
    expect(await findHqInWorkChat(['p1'], since, open, search)).toBeNull()
  })
})

describe('the new-chat check', () => {
  it('shows the chat reports and the waiting conversations as data', () => {
    const prompt = hqInWorkChatPrompt(
      {
        sessionId: 'claude_specs',
        project: 'acme-agents',
        address: 'acme-agents/spec-drafts',
        reports: ['Studied the 11 tasks of track 4: the spec-draft agent profile']
      },
      [
        {
          id: 'c1',
          title: 'Bob announces spec drafts',
          texts: ['From the 16th the agent drafts specs']
        }
      ]
    )
    expect(prompt).toContain('acme-agents/spec-drafts (project acme-agents)')
    expect(prompt).toContain('- Studied the 11 tasks of track 4')
    expect(prompt).toContain('- c1 — Bob announces spec drafts — From the 16th')
  })

  it('reads every offered id the model names, and nothing from an unusable answer', () => {
    expect(
      parseHqInWorkChatAnswer(
        '{"conversations": [{"id": "c1", "confidence": 0.85, "why": "same plan"}, {"id": "c9", "confidence": 0.9}, {"id": "c2", "confidence": 7}]}',
        ['c1', 'c2']
      )
    ).toEqual([
      { conversationId: 'c1', confidence: 0.85, why: 'same plan' },
      { conversationId: 'c2', confidence: 1, why: null }
    ])
    expect(parseHqInWorkChatAnswer('{"conversations": []}', ['c1'])).toEqual([])
    expect(parseHqInWorkChatAnswer('{"conversation": "c1"}', ['c1'])).toEqual([])
    expect(parseHqInWorkChatAnswer('no json', ['c1'])).toEqual([])
  })
})

// Why (Codex 03.11): a chat was marked read before the model answered, with only ten conversations shown.
describe('checkHqInWorkChats', () => {
  const chat = { sessionId: 'claude_specs', project: 'acme', address: 'acme/specs', openedAt: 500 }
  const waiting = () =>
    new Map(
      Array.from({ length: 12 }, (_, n) => [
        `c${n}`,
        { id: `c${n}`, title: `Talk ${n}`, texts: ['words'], lastAt: 100 + n }
      ])
    )
  function deps(
    answer: (prompt: string) => { ok: true; text: string } | { ok: false; error: string }
  ) {
    const shown = new Map<string, Set<string> | null>()
    const prompts: string[] = []
    const inWork: string[] = []
    return {
      shown,
      prompts,
      inWork,
      deps: {
        shown,
        reports: () => ['Writes the spec drafts'],
        budget: () => true,
        generate: async (prompt: string) => {
          prompts.push(prompt)
          return answer(prompt)
        },
        noteChecked: (sessionId: string, ids: readonly string[]) =>
          shown.set(sessionId, new Set([...(shown.get(sessionId) ?? []), ...ids])),
        setInWork: (conversationId: string) => {
          inWork.push(conversationId)
        }
      }
    }
  }

  it('shows the chat the conversations past the first ten on the next pass', async () => {
    const run = deps((prompt) =>
      prompt.includes('- c11 ')
        ? { ok: true, text: '{"conversations": [{"id": "c11", "confidence": 0.8}]}' }
        : { ok: true, text: '{"conversations": []}' }
    )
    await checkHqInWorkChats([chat], waiting(), run.deps)
    expect([...(run.shown.get('claude_specs') ?? [])]).toHaveLength(10)
    await checkHqInWorkChats([chat], waiting(), run.deps)
    expect(run.prompts[1]).toContain('- c10 ')
    expect(run.prompts[1]).not.toContain('- c0 ')
    expect(run.inWork).toEqual(['c11'])
    await checkHqInWorkChats([chat], waiting(), run.deps)
    expect(run.prompts).toHaveLength(2)
  })

  it('a failed call leaves the chat to read again; a chat read whole before stays read', async () => {
    let fail = true
    const run = deps(() => (fail ? { ok: false, error: 'busy' } : { ok: true, text: '{}' }))
    await checkHqInWorkChats([chat], waiting(), run.deps)
    expect(run.shown.has('claude_specs')).toBe(false)
    fail = false
    await checkHqInWorkChats([chat], waiting(), run.deps)
    expect(run.shown.get('claude_specs')?.size).toBe(10)

    const old = deps(() => ({ ok: true, text: '{}' }))
    old.shown.set('claude_specs', null)
    await checkHqInWorkChats([chat], waiting(), old.deps)
    expect(old.prompts).toEqual([])
  })
})
