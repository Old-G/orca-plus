import { describe, expect, it } from 'vitest'
import { GoogleToolError } from './google-api-client'
import { viaGoogleMcp } from './google-mcp-route'

describe('viaGoogleMcp', () => {
  it('runs on REST while the MCP server is off, and tries MCP again ten minutes later', async () => {
    let clock = 1_000
    const now = () => clock
    const api = { email: 'ann@acme.example' }
    let mcpCalls = 0
    const off = async (): Promise<string> => {
      mcpCalls++
      throw new GoogleToolError('off', 403, true)
    }
    const rest = async () => 'rest'

    expect(await viaGoogleMcp(api, 'gmail', off, rest, now)).toBe('rest')
    clock += 9 * 60_000
    expect(await viaGoogleMcp(api, 'gmail', off, rest, now)).toBe('rest')
    expect(mcpCalls).toBe(1)
    // Another service of the same account still tries MCP.
    expect(await viaGoogleMcp(api, 'drive', async () => 'mcp', rest, now)).toBe('mcp')
    clock += 2 * 60_000
    expect(await viaGoogleMcp(api, 'gmail', async () => 'mcp', rest, now)).toBe('mcp')
  })

  it('passes any other refusal on instead of running the method twice', async () => {
    const refused = async (): Promise<string> => {
      throw new GoogleToolError('Google refused: bad id', 400)
    }
    let restCalls = 0
    await expect(
      viaGoogleMcp({ email: 'bob@acme.example' }, 'calendar', refused, async () => {
        restCalls++
        return 'rest'
      })
    ).rejects.toThrow('bad id')
    expect(restCalls).toBe(0)
  })
})
