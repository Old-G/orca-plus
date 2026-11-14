import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../shared/agent-session/journal/agent-session-journal-types'
import { createHaikuEffortPick, parseEffortAnswer } from './haiku-effort-pick'
import {
  autoEffortMessageOptions,
  provideNativeChatAutoEffort,
  recentAutoEffortOutcomes,
  type NativeChatAutoEffortService
} from './native-chat-auto-effort'
import { modelEffortLevels } from './chat-model-effort-levels'

const user = (text: string): AgentJournalItemBody => ({
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text }]
})

const agentSaid = (text: string): AgentJournalRenderItem => ({
  itemId: 'a1',
  revision: 1,
  sequence: 1,
  observedAt: 1,
  body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
})

function serve(over: Partial<NativeChatAutoEffortService> = {}) {
  const pick = vi.fn(async () => 'xhigh' as const)
  provideNativeChatAutoEffort({ enabled: () => true, pick, ...over })
  return pick
}

afterEach(() => provideNativeChatAutoEffort(null))

describe('chat auto effort', () => {
  it('sets the picked effort and shows the classifier the agent message being answered', async () => {
    const pick = serve()
    const options = await autoEffortMessageOptions({
      provider: 'claude',
      options: { model: 'opus', effort: 'high' },
      body: user('да'),
      items: () => [agentSaid('План: переписать хранилище. Начинать?')]
    })
    expect(options).toEqual({ model: 'opus', effort: 'xhigh' })
    expect(pick).toHaveBeenCalledWith({
      message: 'да',
      previousAgentMessage: 'План: переписать хранилище. Начинать?'
    })
  })

  it('picks low for a trivial message, and keeps picking after a chat went low', async () => {
    const pick = vi.fn(async () => 'low' as const)
    serve({ pick })
    const base = { provider: 'claude', body: user('ок'), items: () => [] }
    expect(await autoEffortMessageOptions({ ...base, options: { effort: 'high' } })).toEqual({
      effort: 'low'
    })
    // Why: the pick is saved as the chat's effort, so the next message arrives with low.
    serve()
    expect(await autoEffortMessageOptions({ ...base, options: { effort: 'low' } })).toEqual({
      effort: 'xhigh'
    })
    expect(pick).toHaveBeenCalledOnce()
  })

  it('never hands an effort to a model with no effort control, or one it does not offer', async () => {
    const base = { provider: 'claude', body: user('go'), items: () => [] }
    const pick = serve()
    const none = await autoEffortMessageOptions({
      ...base,
      options: { model: 'haiku' },
      effortLevels: () => new Set<string>()
    })
    expect(none).toEqual({ model: 'haiku' })
    expect(pick).not.toHaveBeenCalled()
    expect(recentAutoEffortOutcomes()[0]?.result).toBe('no-effort-control')
    const partial = await autoEffortMessageOptions({
      ...base,
      options: { effort: 'high' },
      effortLevels: () => new Set(['low', 'medium', 'high'])
    })
    expect(partial).toEqual({ effort: 'high' })
  })

  it("reads a model's levels from the model list, and nothing from a list that does not name it", () => {
    const models = [
      { id: 'opus', label: 'Opus', isDefault: true, efforts: [{ value: 'high', label: 'High' }] },
      { id: 'haiku', label: 'Haiku', isDefault: false, efforts: [] }
    ]
    expect(modelEffortLevels(models, 'haiku')).toEqual(new Set())
    expect(modelEffortLevels(models, undefined)).toEqual(new Set(['high']))
    expect(modelEffortLevels(models, 'sonnet')).toBeNull()
  })

  it('leaves the options alone when off, not Claude, hand-picked Max, or unanswered', async () => {
    const base = { provider: 'claude', body: user('go'), items: () => [] }
    serve({ enabled: () => false })
    expect(await autoEffortMessageOptions({ ...base, options: { effort: 'high' } })).toEqual({
      effort: 'high'
    })
    const pick = serve()
    expect(
      await autoEffortMessageOptions({ ...base, provider: 'codex', options: { effort: 'high' } })
    ).toEqual({ effort: 'high' })
    expect(await autoEffortMessageOptions({ ...base, options: { effort: 'max' } })).toEqual({
      effort: 'max'
    })
    expect(pick).not.toHaveBeenCalled()
    serve({ pick: async () => null })
    expect(await autoEffortMessageOptions({ ...base, options: { effort: 'high' } })).toEqual({
      effort: 'high'
    })
  })
})

describe('chat auto effort outcomes', () => {
  it('records the pick and a miss, newest first, for Settings', async () => {
    const base = { provider: 'claude', body: user('проверь'), items: () => [], options: {} }
    serve({ pick: async () => null })
    await autoEffortMessageOptions(base)
    serve()
    await autoEffortMessageOptions(base)
    expect(recentAutoEffortOutcomes().slice(0, 2)).toMatchObject([
      { result: 'picked', effort: 'xhigh', message: 'проверь' },
      { result: 'no-answer', effort: null }
    ])
  })
})

describe('Haiku effort pick', () => {
  it('asks with the criteria and both messages as data, and reads the level from the JSON', async () => {
    const generate = vi.fn(async (_prompt: string) => ({
      ok: true as const,
      text: '```json\n{"effort": "medium"}\n```'
    }))
    const pick = createHaikuEffortPick(generate)
    expect(await pick({ message: 'статус?', previousAgentMessage: 'Готово.' })).toBe('medium')
    const prompt = String(generate.mock.lastCall?.[0])
    expect(prompt).toContain('xhigh: Hard or open-ended')
    expect(prompt).toContain('low: Trivial')
    expect(prompt).toContain('<previous_agent_message>\nГотово.\n</previous_agent_message>')
    expect(prompt).toContain('<user_message>\nстатус?\n</user_message>')
    expect(prompt).toContain('Answer with JSON only')
  })

  it('answers null on a failed run, an unknown level, no JSON or a thrown error', async () => {
    const ask = (generate: Parameters<typeof createHaikuEffortPick>[0]) =>
      createHaikuEffortPick(generate)({ message: 'x', previousAgentMessage: null })
    expect(await ask(async () => ({ ok: false, error: 'limit' }))).toBeNull()
    expect(await ask(async () => ({ ok: true, text: '{"effort": "max"}' }))).toBeNull()
    expect(await ask(async () => ({ ok: true, text: 'high' }))).toBeNull()
    expect(
      await ask(async () => {
        throw new Error('spawn failed')
      })
    ).toBeNull()
    expect(parseEffortAnswer('{"effort": "xhigh"} trailing')).toBe('xhigh')
    expect(parseEffortAnswer('{broken')).toBeNull()
  })

  it('gives up past the timeout so the chat keeps its effort', async () => {
    vi.useFakeTimers()
    try {
      const pick = createHaikuEffortPick(() => new Promise(() => {}), 6000)
      const answer = pick({ message: 'x', previousAgentMessage: null })
      await vi.advanceTimersByTimeAsync(6000)
      expect(await answer).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
