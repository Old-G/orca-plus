// Custom build (automation-narrow-tools): options that only take tools away.
import { describe, expect, it } from 'vitest'
import { getExtraAgentArgsPlaceholder, parseExtraAgentArgs } from './automation-extra-agent-args'
import type { TuiAgent } from '../catalog/tui-agent'

function rejection(agent: TuiAgent, extraAgentArgs: string) {
  const result = parseExtraAgentArgs({ agent, extraAgentArgs })
  return result.ok ? null : result.error
}

describe('parseExtraAgentArgs — narrowing Claude tools (custom build)', () => {
  it('accepts options that narrow Claude tools', () => {
    expect(
      rejection(
        'claude',
        '--model sonnet --no-chrome --strict-mcp-config --disallowedTools=mcp__a,mcp__b --disallowed-tools=Bash'
      )
    ).toBeNull()
  })

  it.each([
    ['--no-chrome=yes', '"--no-chrome=yes"'],
    ['--strict-mcp-config x', '"x" isn\'t an option'],
    ['--disallowedTools mcp__a', 'needs a value'],
    ['--strict-mcp-config --mcp-config=x.json', '"--mcp-config"'],
    ['--allowedTools=Bash', '"--allowedTools"']
  ] as const)('claude rejects narrowing misuse %j', (extras, message) => {
    expect(rejection('claude', extras)).toContain(message)
  })

  it('keeps the narrowing options out of the placeholder', () => {
    expect(getExtraAgentArgsPlaceholder('claude')).not.toMatch(/chrome|mcp|disallowed/i)
  })
})
