import { describe, expect, it } from 'vitest'
import { structuredAgentSettingGates } from './structured-agent-setting-gates'

describe('structuredAgentSettingGates — lean MCP (custom build)', () => {
  it('reads the profile at each call, so the switch applies to the next chat', () => {
    let settings: Record<string, unknown> = {}
    const gates = structuredAgentSettingGates(() => settings as never)
    expect(gates.leanMcpDenied?.('worker')).toEqual([])
    settings = { agentMcpProfile: 'lean' }
    expect(gates.leanMcpDenied?.('worker')).toContain('mcp__claude_ai_Gmail')
    expect(gates.leanMcpDenied?.('lead')).toEqual([])
    expect(gates.leanMcpDenied?.(null)).toEqual([])
  })
})
