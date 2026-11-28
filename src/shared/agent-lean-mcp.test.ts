import { describe, expect, it } from 'vitest'
import { agentMcpProfile, DEFAULT_LEAN_MCP_DENY, leanMcpDenyRules } from './agent-lean-mcp'

describe('lean MCP profile (custom build)', () => {
  it('is full — nothing hidden — unless the setting says lean', () => {
    for (const settings of [
      undefined,
      null,
      {},
      { agentMcpProfile: 'full' },
      { agentMcpProfile: 'x' }
    ]) {
      expect(agentMcpProfile(settings)).toBe('full')
      expect(leanMcpDenyRules(settings, 'worker')).toEqual([])
    }
  })

  it('hides the default servers from a worker and a review chat only', () => {
    const lean = { agentMcpProfile: 'lean' as const }
    const worker = leanMcpDenyRules(lean, 'worker')
    expect(worker).toEqual(DEFAULT_LEAN_MCP_DENY.map((name) => `mcp__${name}`))
    expect(worker).toContain('mcp__claude_ai_Gmail')
    expect(worker).toContain('mcp__claude_ai_LH-Odoo')
    expect(leanMcpDenyRules(lean, 'review')).toEqual(worker)
    for (const role of ['lead', 'sublead', null] as const) {
      expect(leanMcpDenyRules(lean, role)).toEqual([])
    }
  })

  it("takes the owner's own list, written as /mcp shows it, and falls back when it is empty or damaged", () => {
    expect(
      leanMcpDenyRules(
        { agentMcpProfile: 'lean', agentLeanMcpDeny: ['claude.ai Kite', 'acme_crm'] },
        'worker'
      )
    ).toEqual(['mcp__claude_ai_Kite', 'mcp__acme_crm'])
    const byDefault = DEFAULT_LEAN_MCP_DENY.map((name) => `mcp__${name}`)
    for (const agentLeanMcpDeny of [[], '', 7, ['*'], [1, null]]) {
      expect(leanMcpDenyRules({ agentMcpProfile: 'lean', agentLeanMcpDeny }, 'worker')).toEqual(
        byDefault
      )
    }
  })
})
