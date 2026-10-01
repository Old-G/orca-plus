import { describe, expect, it } from 'vitest'
import { acquired, fakeClaude } from './claude-structured-session-test-support'

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Rows from Claude Code 2.1.287's list_models: no `[1m]` row any more, while a
 *  `model: "opus[1m]"` setting still makes the CLI report `claude-opus-5-5[1m]`. */
const CATALOG = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Default (recommended)',
    supportsEffort: true,
    supportedEffortLevels: EFFORTS
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus 5.5',
    supportsEffort: true,
    supportedEffortLevels: EFFORTS
  },
  {
    value: 'claude-opus-5',
    resolvedModel: 'claude-opus-5',
    displayName: 'Opus 5',
    supportsEffort: true,
    supportedEffortLevels: EFFORTS
  },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' }
]

function settingsApplying(model: string) {
  return {
    effective: { model: 'opus[1m]' },
    sources: [{ source: 'userSettings', settings: { model: 'opus[1m]' } }],
    applied: { model, effort: 'high', advisor: null, ultracode: false }
  }
}

async function optionsFor(appliedModel: string) {
  const adapter = await acquired(
    fakeClaude({
      initProof: 'session-start',
      initModels: CATALOG,
      settings: settingsApplying(appliedModel),
      routes: { list_models: () => CATALOG }
    })
  )
  return adapter.readOptions({ sessionId: 'session-1', fence: 7 })
}

describe('Claude model reported with a context-window suffix', () => {
  it('shows the listed row it runs, with that row’s efforts', async () => {
    const { current, models } = await optionsFor('claude-opus-5-5[1m]')

    expect(current).toMatchObject({ model: 'opus', effort: 'high' })
    // A raw `claude-opus-5-5[1m]` row has no efforts, so the picker lost Reasoning effort.
    expect(models.map((model) => model.id)).not.toContain('claude-opus-5-5[1m]')
    expect(models.find((model) => model.id === 'opus')?.efforts).toHaveLength(EFFORTS.length)
  })

  it('never reads the suffixed id as a shorter model it merely contains', async () => {
    const { current } = await optionsFor('claude-opus-5[1m]')

    expect(current.model).toBe('claude-opus-5')
  })

  it('keeps an id no row runs as itself', async () => {
    const { current, models } = await optionsFor('claude-unknown-9[1m]')

    expect(current.model).toBe('claude-unknown-9[1m]')
    expect(models.map((model) => model.id)).toContain('claude-unknown-9[1m]')
  })
})
