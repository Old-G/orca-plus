import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../shared/agent-session-journal-types'
import { pickEffortWithJev } from './jev-effort-pick'
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
  provideNativeChatAutoEffort({ enabled: () => true, key: () => 'k', pick, ...over })
  return pick
}

afterEach(() => provideNativeChatAutoEffort(null))

describe('chat auto effort', () => {
  it('sets the picked effort and shows Jev the agent message being answered', async () => {
    const pick = serve()
    const options = await autoEffortMessageOptions({
      provider: 'claude',
      options: { model: 'opus', effort: 'high' },
      body: user('да'),
      items: () => [agentSaid('План: переписать хранилище. Начинать?')]
    })
    expect(options).toEqual({ model: 'opus', effort: 'xhigh' })
    expect(pick).toHaveBeenCalledWith({
      key: 'k',
      message: 'да',
      previousAgentMessage: 'План: переписать хранилище. Начинать?'
    })
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

  it('leaves the options alone when off, keyless, not Claude, hand-picked Max, or unanswered', async () => {
    const base = { provider: 'claude', body: user('go'), items: () => [] }
    serve({ enabled: () => false })
    expect(await autoEffortMessageOptions({ ...base, options: { effort: 'high' } })).toEqual({
      effort: 'high'
    })
    serve({ key: () => null })
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
  it('records the pick and a keyless miss, newest first, for Settings', async () => {
    const base = { provider: 'claude', body: user('проверь'), items: () => [], options: {} }
    serve({ key: () => null })
    await autoEffortMessageOptions(base)
    serve()
    await autoEffortMessageOptions(base)
    expect(recentAutoEffortOutcomes().slice(0, 2)).toMatchObject([
      { result: 'picked', effort: 'xhigh', message: 'проверь' },
      { result: 'no-key', effort: null }
    ])
  })
})

describe('Jev effort pick', () => {
  it('reads the choice from the decisions answer', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ answers: { effort: { type: 'choice', choice: 'medium' } } }),
          { status: 200 }
        )
    )
    expect(
      await pickEffortWithJev({
        key: 'k',
        message: 'статус?',
        previousAgentMessage: null,
        fetchImpl
      })
    ).toBe('medium')
    const sent: unknown = fetchImpl.mock.lastCall
    expect(JSON.stringify(sent)).toContain('xhigh')
  })

  it('answers null on an error status, an unknown level or a network failure', async () => {
    const reply = (body: unknown, status = 200) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    const ask = (fetchImpl: typeof fetch) =>
      pickEffortWithJev({ key: 'k', message: 'x', previousAgentMessage: null, fetchImpl })
    expect(await ask(reply({ error: {} }, 402))).toBeNull()
    expect(await ask(reply({ answers: { effort: { choice: 'max' } } }))).toBeNull()
    expect(
      await ask(
        vi.fn(async () => {
          throw new Error('offline')
        })
      )
    ).toBeNull()
  })
})
