import { describe, expect, it } from 'vitest'
import { acquired, fakeClaude } from './claude-structured-session-test-support'
import { listedModels } from './claude-structured-model-catalog'
import { wireClaudeModels } from './claude-structured-catalog-listing'
import { findModelRowByIdentity } from '../native-chat/agent-model-catalog/agent-model-row-identity'
import { readStructuredAgentSessionOptions } from '../native-chat/agent-session-wire/structured-agent-session-options-read'
import type { StructuredAgentSessionMutationContext } from '../native-chat/agent-session-wire/structured-agent-session-host-mutations'
import { claudeAndCodexAgents } from '../native-chat/agent-session-wire/structured-agent-session-adapter-router-test-support'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

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
const INSTALLED = wireClaudeModels(listedModels({ models: CATALOG }))

function settingsApplying(model: string) {
  return {
    effective: { model: 'opus[1m]' },
    sources: [{ source: 'userSettings', settings: { model: 'opus[1m]' } }],
    applied: { model, effort: 'high', advisor: null, ultracode: false }
  }
}

/** The picker's read: the live child's answer, resolved by the host against the installed rows. */
async function optionsFor(appliedModel: string) {
  const adapter = await acquired(
    fakeClaude({
      initProof: 'session-start',
      initModels: CATALOG,
      settings: settingsApplying(appliedModel),
      routes: { list_models: () => CATALOG }
    })
  )
  const live = await adapter.readOptions({ sessionId: 'session-1', fence: 7 })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resting read and the catalog key touch only these fields.
  const record = {
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/homes/a' },
    providerHandleChain: [],
    location: { executionHostId: 'local', wslDistro: null },
    lease: { claimStatus: 'released', ownerProcess: null, runtimeFence: 1 },
    options: {}
  } as unknown as AgentSessionRecord
  const resting = {
    child: { fence: 1 },
    params: { provider: 'claude' },
    journal: {
      threadGoal: () => null,
      visitItems: () => {},
      wroteBeforeOpen: () => false,
      submissions: () => [],
      contextUsage: () => null,
      context: { floor: () => null }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this read touches only the declared context fields.
  const context = {
    deps: {
      adapter: { readOptions: async () => live },
      agents: claudeAndCodexAgents(),
      store: { getRecord: () => record },
      modelCatalog: { read: async () => ({ origin: 'probe', models: INSTALLED, fetchedAt: 1 }) }
    },
    serialize: (_sessionId: string, task: () => Promise<unknown>) => task(),
    openConversation: async () => resting,
    conversation: async () => resting
  } as unknown as StructuredAgentSessionMutationContext
  return readStructuredAgentSessionOptions(context, 'session-1', { readsWithoutModel: true })
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

  it('prefers a listed suffixed row over its base model', () => {
    const rows = [
      { id: 'opus', resolvedModel: 'claude-opus-5-5' },
      { id: 'opus[1m]', resolvedModel: 'claude-opus-5-5[1m]' }
    ]

    expect(findModelRowByIdentity(rows, 'opus[1m]')?.id).toBe('opus[1m]')
    expect(findModelRowByIdentity(rows, 'claude-opus-5-5[1m]')?.id).toBe('opus[1m]')
    expect(findModelRowByIdentity(rows.slice(0, 1), 'opus[1m]')?.id).toBe('opus')
  })
})
