import { describe, expect, it, vi } from 'vitest'
import {
  checkClaudeConnectorGap,
  claudeConnectorGap,
  parseClaudeAiConnectors
} from './claude-connector-gap'

const WORK = [
  'Checking MCP server health…',
  '',
  'claude.ai Claude Docs: https://api.example.com/v1/pages/mcp - ✔ Connected',
  'claude.ai Acme Hub: https://ai.acme.example/hub-mcp/mcp - ✔ Connected',
  'claude.ai Acme Hub (Read): https://ai.acme.example/hub-mcp-read/mcp - ✔ Connected',
  'claude.ai Fathom – Meetings: https://api.fathom.example/mcp - ! Needs authentication',
  'claude.ai Acme-GitLab: https://ai.acme.example/gitlab-mcp/mcp - ! Needs authentication',
  'claude.ai Slack: https://mcp.slack.example/mcp - ✔ Connected',
  'clickup: https://mcp.clickup.example/mcp (HTTP) - ✔ Connected'
].join('\n')

const PERSONAL = [
  'claude.ai Claude Docs: https://api.example.com/v1/pages/mcp - ✔ Connected',
  'claude.ai Acme Hub: https://ai.acme.example/hub-mcp/mcp - ! Needs authentication',
  'claude.ai Acme-GitLab: https://ai.acme.example/gitlab-mcp/mcp - ! Needs authentication',
  'claude.ai Slack: https://mcp.slack.example/mcp - ✔ Connected'
].join('\n')

describe('claude connector gap', () => {
  it('reads claude.ai connectors only, names with spaces and dashes whole', () => {
    const connectors = parseClaudeAiConnectors(WORK)
    expect([...connectors.keys()]).toEqual([
      'Claude Docs',
      'Acme Hub',
      'Acme Hub (Read)',
      'Fathom – Meetings',
      'Acme-GitLab',
      'Slack'
    ])
    expect(connectors.get('Acme Hub')).toBe(true)
    expect(connectors.get('Acme-GitLab')).toBe(false)
  })

  it('names what worked before and does not now — dropped or never added — not what failed on both', () => {
    expect(
      claudeConnectorGap(parseClaudeAiConnectors(WORK), parseClaudeAiConnectors(PERSONAL))
    ).toEqual(['Acme Hub', 'Acme Hub (Read)'])
  })

  it('raises one bell item for the new account, and clears it when nothing is missing', async () => {
    const syncBell = vi.fn()
    const deps = {
      readConnectors: async (dir: string) =>
        parseClaudeAiConnectors(dir === '/w' ? WORK : PERSONAL),
      accountLabel: (dir: string) => (dir === '/w' ? 'Acme' : 'Personal'),
      syncBell,
      log: () => {}
    }
    await expect(checkClaudeConnectorGap(deps, '/w', '/p')).resolves.toEqual([
      'Acme Hub',
      'Acme Hub (Read)'
    ])
    const [item] = syncBell.mock.calls[0][0]
    expect(item.title).toBe('Personal: 2 connectors are not connected')
    expect(item.body).toContain('Acme Hub, Acme Hub (Read)')

    await checkClaudeConnectorGap(deps, '/p', '/w')
    expect(syncBell).toHaveBeenLastCalledWith([])
  })

  it('does nothing when the folder did not change', async () => {
    const readConnectors = vi.fn()
    const deps = { readConnectors, accountLabel: () => '', syncBell: vi.fn(), log: () => {} }
    await expect(checkClaudeConnectorGap(deps, '/w', '/w')).resolves.toEqual([])
    expect(readConnectors).not.toHaveBeenCalled()
  })
})
