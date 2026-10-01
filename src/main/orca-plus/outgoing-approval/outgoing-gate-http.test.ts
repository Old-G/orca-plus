import { afterEach, describe, expect, it } from 'vitest'
import { AgentHookServer } from '../../agent-hooks/server'
import { PulseDb } from '../pulse/pulse-db'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { createOutgoingGateRequestHandler } from './outgoing-gate-http'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

async function startServer(withGate = true, holdMs = 2_000) {
  const db = new PulseDb(':memory:')
  const gate = new OutgoingApprovalGate({ db: () => db, holdMs })
  const server = new AgentHookServer()
  if (withGate) {
    server.setOutgoingGateHandler(createOutgoingGateRequestHandler(() => gate))
  }
  await server.start({ env: 'production' })
  cleanups.push(() => {
    server.stop()
    db.close()
  })
  const env = server.buildPtyEnv()
  const post = async (path: string, body: unknown, token = env.ORCA_AGENT_HOOK_TOKEN) => {
    const response = await fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Orca-Agent-Hook-Token': token,
        'X-Orca-Pane-Key': 'tab-1:leaf-1'
      },
      body: JSON.stringify(body)
    })
    return { status: response.status, text: await response.text() }
  }
  return { gate, db, post }
}

const pushHook = {
  session_id: 's1',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git push --force origin main' },
  tool_use_id: 'toolu_push'
}

describe('hook server /outgoing-gate routes', () => {
  it('passes a local command', async () => {
    const { post } = await startServer()
    expect(
      await post('/outgoing-gate/submit', { ...pushHook, tool_input: { command: 'ls' } })
    ).toEqual({
      status: 200,
      text: 'pass\n'
    })
  })

  it('holds a push, long-polls, and releases it once approved', async () => {
    const { post, gate, db } = await startServer()
    const submitted = await post('/outgoing-gate/submit', pushHook)
    const [verb, id] = submitted.text.trim().split(' ')
    expect(verb).toBe('pending')
    expect(db.getDraft(id)?.call?.paneKey).toBe('tab-1:leaf-1')

    const waiting = post('/outgoing-gate/wait', { id })
    await new Promise((resolve) => setTimeout(resolve, 50))
    gate.decide(id, 'approved')
    const reply = await waiting
    const [first, json] = reply.text.split('\n')
    expect(first).toBe('final')
    expect(JSON.parse(json).hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('outlives the 5 s slowloris cap while a call is held', async () => {
    const { post, gate } = await startServer(true, 8_000)
    const id = (await post('/outgoing-gate/submit', pushHook)).text.trim().split(' ')[1]
    const waiting = post('/outgoing-gate/wait', { id })
    await new Promise((resolve) => setTimeout(resolve, 5_500))
    gate.decide(id, 'rejected')
    expect((await waiting).text).toMatch(/^final\n.*"deny"/)
  }, 10_000)

  it('rejects a wrong token and unknown routes', async () => {
    const { post } = await startServer()
    expect((await post('/outgoing-gate/submit', pushHook, 'wrong')).status).toBe(403)
    expect((await post('/outgoing-gate/decide', { id: 'x' })).status).toBe(404)
  })

  it('answers 503 until the gate is wired, so the hook retries rather than passes', async () => {
    const { post } = await startServer(false)
    expect((await post('/outgoing-gate/submit', pushHook)).status).toBe(503)
  })
})
