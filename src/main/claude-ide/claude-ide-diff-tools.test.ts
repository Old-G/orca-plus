import { describe, expect, it, vi } from 'vitest'
import { createClaudeIdeMcpSession } from './claude-ide-mcp-session'
import { createClaudeIdeToolExecutor } from './claude-ide-tool-executor'

const diffArgs = {
  old_file_path: '/repo/a.ts',
  new_file_path: '/repo/a.ts',
  new_file_contents: 'next',
  tab_name: '✻ [Claude Code] a.ts (abc123) ⧉'
}

function executor(askRenderer = vi.fn(async (_method: string, _params: unknown) => '{}')) {
  return {
    askRenderer,
    callTool: createClaudeIdeToolExecutor({ askRenderer, latestSelection: () => null })
  }
}

describe('claude-ide diff tools', () => {
  it('openDiff waits for the user and answers FILE_SAVED with the accepted contents', async () => {
    const { askRenderer, callTool } = executor(
      vi.fn(async () => JSON.stringify({ accepted: true, contents: 'edited by user' }))
    )
    const result = await callTool('openDiff', diffArgs)
    expect(askRenderer).toHaveBeenCalledWith('openDiff', diffArgs, { waitForUser: true })
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'FILE_SAVED' },
        { type: 'text', text: 'edited by user' }
      ]
    })
  })

  it('openDiff answers DIFF_REJECTED with the tab name when the user rejects or closes it', async () => {
    const { callTool } = executor(vi.fn(async () => JSON.stringify({ accepted: false })))
    expect(await callTool('openDiff', diffArgs)).toEqual({
      content: [
        { type: 'text', text: 'DIFF_REJECTED' },
        { type: 'text', text: diffArgs.tab_name }
      ]
    })
  })

  it('openDiff reports a renderer failure as an error so the CLI keeps its terminal prompt', async () => {
    const { callTool } = executor(
      vi.fn(async () => {
        throw new Error('Orca editor window is not available')
      })
    )
    expect(await callTool('openDiff', diffArgs)).toMatchObject({ isError: true })
  })

  it('close_tab and closeAllDiffTabs answer with the extension texts', async () => {
    const { callTool } = executor(
      vi.fn(async (method: string) => (method === 'closeAllDiffTabs' ? '{"closed":2}' : '{}'))
    )
    expect(await callTool('close_tab', { tab_name: diffArgs.tab_name })).toEqual({
      content: [{ type: 'text', text: 'TAB_CLOSED' }]
    })
    expect(await callTool('closeAllDiffTabs', {})).toEqual({
      content: [{ type: 'text', text: 'CLOSED_2_DIFF_TABS' }]
    })
  })

  it('lists close_tab without a description, like the extension', async () => {
    const sent: unknown[] = []
    const session = createClaudeIdeMcpSession({
      serverName: 'Orca',
      serverVersion: '1',
      callTool: executor().callTool,
      send: (message) => sent.push(message)
    })
    await session.handleRawMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    const reply: { result: { tools: { name: string; description?: string }[] } } = JSON.parse(
      JSON.stringify(sent[0])
    )
    const tools = reply.result.tools
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['openDiff', 'close_tab', 'closeAllDiffTabs'])
    )
    expect(tools.find((tool) => tool.name === 'close_tab')).not.toHaveProperty('description')
  })

  it('closes the diff tabs a disconnected CLI was still waiting on', async () => {
    let finishDiff: (text: string) => void = () => {}
    const askRenderer = vi.fn(async (method: string) =>
      method === 'openDiff' ? new Promise<string>((resolve) => (finishDiff = resolve)) : '{}'
    )
    const session = createClaudeIdeMcpSession({
      serverName: 'Orca',
      serverVersion: '1',
      callTool: executor(askRenderer).callTool,
      send: () => {}
    })
    void session.handleRawMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'openDiff', arguments: diffArgs }
      })
    )
    await vi.waitFor(() =>
      expect(askRenderer).toHaveBeenCalledWith('openDiff', diffArgs, expect.anything())
    )
    session.dispose()
    expect(askRenderer).toHaveBeenCalledWith(
      'closeDiffTab',
      { tab_name: diffArgs.tab_name },
      { waitForUser: false }
    )
    finishDiff('{"accepted":false}')
  })
})
