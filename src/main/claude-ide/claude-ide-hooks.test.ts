import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyClaudeIdeTerminalEnv,
  buildClaudeIdeSdkOptions,
  setActiveClaudeIdeServer
} from './claude-ide-hooks'

afterEach(() => setActiveClaudeIdeServer(null))

describe('applyClaudeIdeTerminalEnv', () => {
  it('points local terminals at this Orca and replaces an inherited IDE port', () => {
    setActiveClaudeIdeServer({ port: 38111, version: '1', callTool: vi.fn() })
    const env: Record<string, string> = { CLAUDE_CODE_SSE_PORT: '5555' }
    applyClaudeIdeTerminalEnv(env, {})
    expect(env.CLAUDE_CODE_SSE_PORT).toBe('38111')
  })

  it('gives WSL panes no port (separate loopback) and strips inherited ones when idle', () => {
    setActiveClaudeIdeServer({ port: 38111, version: '1', callTool: vi.fn() })
    const wsl: Record<string, string> = { CLAUDE_CODE_SSE_PORT: '5555' }
    applyClaudeIdeTerminalEnv(wsl, { isWsl: true })
    expect(wsl).toEqual({})

    setActiveClaudeIdeServer(null)
    const idle: Record<string, string> = { CLAUDE_CODE_SSE_PORT: '5555' }
    applyClaudeIdeTerminalEnv(idle, {})
    expect(idle).toEqual({})
  })
})

describe('buildClaudeIdeSdkOptions', () => {
  it('adds nothing when the IDE server is not running (headless hosts)', () => {
    const sdk = { createSdkMcpServer: vi.fn(), tool: vi.fn() }
    expect(buildClaudeIdeSdkOptions(sdk)).toEqual({})
    expect(sdk.createSdkMcpServer).not.toHaveBeenCalled()
  })

  it('registers the IDE tools on an SDK server named `ide`', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }]
    }))
    setActiveClaudeIdeServer({ port: 1, version: '9.9.9', callTool })
    const tool = vi.fn(
      (
        name: string,
        _description: string,
        _argumentSchema: unknown,
        handler: (args: unknown) => Promise<unknown>
      ) => ({ name, handler })
    )
    const createSdkMcpServer = vi.fn((options: unknown) => ({
      type: 'sdk',
      options
    }))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only records the calls the SDK functions receive.
    const result = buildClaudeIdeSdkOptions({
      createSdkMcpServer,
      tool
    } as never)
    expect(Object.keys(result.mcpServers ?? {})).toEqual(['ide'])
    expect(createSdkMcpServer.mock.calls[0][0]).toMatchObject({
      name: 'ide',
      version: '9.9.9'
    })
    const names = tool.mock.calls.map((args) => args[0])
    expect(names).toContain('getDiagnostics')
    // Why: only the interactive CLI drives IDE diffs; the SDK never calls them.
    expect(names).not.toContain('openDiff')
    expect(names).not.toContain('close_tab')
    expect(names).not.toContain('closeAllDiffTabs')
    await tool.mock.calls[0][3]({ uri: 'file:///x' })
    expect(callTool).toHaveBeenCalledWith(tool.mock.calls[0][0], {
      uri: 'file:///x'
    })
  })
})
