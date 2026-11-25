import { describe, expect, it } from 'vitest'
import { callGoogleMcpTool, type GoogleMcpRequest } from './google-mcp-call'

class Refused extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

/** One tool call against a fake Google that answers `answer`; returns the value or the refusal. */
async function callWith(answer: Response, projectId?: string) {
  const sent: GoogleMcpRequest[] = []
  const outcome = await callGoogleMcpTool(
    async (request) => {
      sent.push(request)
      return answer
    },
    (failure) => {
      throw new Refused(failure.message, failure.status)
    },
    {
      service: 'gmail',
      tool: 'search_threads',
      arguments: { query: 'from:ann@acme.example' },
      read: (value) => value,
      ...(projectId ? { projectId } : {})
    }
  ).then(
    (value) => ({ value }),
    (error: unknown) => ({ error: error as Refused })
  )
  return { outcome, sent }
}

describe('a call to a Google MCP tool', () => {
  it('posts a JSON-RPC tools/call to the service endpoint, accepting JSON and event streams', async () => {
    const { sent } = await callWith(
      Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { threads: [] } } })
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://gmailmcp.googleapis.com/mcp/v1')
    expect(sent[0]?.accept).toBe('application/json, text/event-stream')
    expect(JSON.parse(sent[0]?.body ?? '')).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'search_threads', arguments: { query: 'from:ann@acme.example' } }
    })
  })

  it('reads the structured answer, else the text read as JSON, from JSON or an event stream', async () => {
    expect(
      (
        await callWith(
          Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { a: 1 } } })
        )
      ).outcome
    ).toEqual({ value: { a: 1 } })
    const stream = [
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"b":2}' }] } })}`,
      ''
    ].join('\n')
    expect(
      (await callWith(new Response(stream, { headers: { 'content-type': 'text/event-stream' } })))
        .outcome
    ).toEqual({ value: { b: 2 } })
  })

  it('turns a refused tool into one sentence: a turned-off MCP API names its Console page', async () => {
    const { outcome } = await callWith(
      Response.json(
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Gmail MCP API has not been used in project 123 before or it is disabled.'
              }
            ]
          }
        },
        { status: 403 }
      ),
      'orca-demo'
    )
    expect('error' in outcome && outcome.error.status).toBe(403)
    expect('error' in outcome && outcome.error.message).toBe(
      "Google's Gmail MCP server is turned off for this app. Ask your owner to turn it on: https://console.cloud.google.com/apis/library/gmailmcp.googleapis.com?project=orca-demo"
    )
  })

  it('refuses a tool error Google sent with 200, and a JSON-RPC error, with what Google said', async () => {
    const toolError = await callWith(
      Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: { isError: true, content: [{ type: 'text', text: 'Invalid thread id.' }] }
      })
    )
    expect('error' in toolError.outcome && toolError.outcome.error.message).toBe(
      'Google refused: Invalid thread id.'
    )
    const rpcError = await callWith(
      Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown tool' } })
    )
    expect('error' in rpcError.outcome && rpcError.outcome.error.message).toBe(
      'Google refused: Unknown tool'
    )
  })
})
