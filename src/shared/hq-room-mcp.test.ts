import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { readHqSpaceFile, resolveHqSpaces } from './hq-spaces'
import { hqRoomMcpDenyRules, hqRoomMcpServerName } from './hq-room-mcp'

describe('hqRoomMcpServerName', () => {
  it('takes a server as its tools name it or as /mcp lists it', () => {
    expect(hqRoomMcpServerName('acme_crm')).toBe('acme_crm')
    expect(hqRoomMcpServerName('mcp__acme_crm')).toBe('acme_crm')
    expect(hqRoomMcpServerName('mcp__acme_crm__list_orders')).toBe('acme_crm')
    expect(hqRoomMcpServerName('claude.ai Acme CRM')).toBe('claude_ai_Acme_CRM')
    expect(hqRoomMcpServerName('plugin:kite:kite')).toBe('plugin_kite_kite')
    expect(hqRoomMcpServerName('claude.ai Acme*')).toBe('claude_ai_Acme*')
  })

  it('refuses an entry that would hide every server', () => {
    for (const entry of ['*', ' * ', 'a*', '', 'mcp__*', '**']) {
      expect(hqRoomMcpServerName(entry)).toBeNull()
    }
  })
})

describe('hqRoomMcpDenyRules', () => {
  it('turns a room file into one rule per server', () => {
    const file = readHqSpaceFile(
      'acme',
      parse(
        'name: Acme\nmcp:\n  deny:\n    - claude.ai Acme*\n    - kite\n    - kite\n    - "*"\n    - 7\n'
      )
    )
    expect(file?.mcpDeny).toEqual(['claude.ai Acme*', 'kite', 'kite', '*'])
    expect(hqRoomMcpDenyRules(file?.mcpDeny)).toEqual(['mcp__claude_ai_Acme*', 'mcp__kite'])
    const [space] = resolveHqSpaces(file ? [{ slug: 'acme', file }] : [], [])
    expect(space?.mcpDeny).toEqual(['claude.ai Acme*', 'kite', 'kite', '*'])
  })

  it('has no rules for a room without the list or with a malformed one', () => {
    expect(hqRoomMcpDenyRules(undefined)).toEqual([])
    expect(readHqSpaceFile('acme', parse('name: Acme\nmcp: deny'))?.mcpDeny).toEqual([])
    expect(readHqSpaceFile('acme', parse('name: Acme\nmcp:\n  deny: kite'))?.mcpDeny).toEqual([])
    const file = readHqSpaceFile('acme', { name: 'Acme' })
    const [space] = resolveHqSpaces(file ? [{ slug: 'acme', file }] : [], [])
    expect(space).toBeDefined()
    expect(space).not.toHaveProperty('mcpDeny')
  })
})
