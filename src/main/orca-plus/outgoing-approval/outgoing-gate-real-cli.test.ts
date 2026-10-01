// Opt-in: ORCA_REAL_CLAUDE_CLI_TEST=1. Drives the real Claude CLI (Haiku, your login) through the gate
// hook from a throwaway --settings file, so ~/.claude/settings.json is never touched.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import { AgentHookServer } from '../../agent-hooks/server'
import { PulseDb } from '../pulse/pulse-db'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { createOutgoingGateRequestHandler } from './outgoing-gate-http'
import { withOutgoingGateHook } from './outgoing-gate-hook-install'
import { buildOutgoingGateScript } from './outgoing-gate-hook-script'

const enabled = process.env.ORCA_REAL_CLAUDE_CLI_TEST === '1' && process.platform !== 'win32'
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    cleanup()
  }
})

// A stdio MCP server with one write tool; a call leaves a marker file holding its arguments.
const FAKE_SLACK_SERVER = `
const fs = require('node:fs')
const readline = require('node:readline')
const marker = process.argv[2]
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') reply(msg.id, { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'testslack', version: '1.0.0' } })
  else if (msg.method === 'tools/list') reply(msg.id, { tools: [{ name: 'send_message', description: 'Send a Slack message to a channel', inputSchema: { type: 'object', properties: { channel_id: { type: 'string' }, message: { type: 'string' } }, required: ['channel_id', 'message'] } }] })
  else if (msg.method === 'tools/call') { fs.writeFileSync(marker, JSON.stringify(msg.params.arguments)); reply(msg.id, { content: [{ type: 'text', text: 'sent' }] }) }
  else if (msg.id !== undefined) reply(msg.id, {})
})
`

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-gate-real-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const script = join(dir, 'outgoing-gate.sh')
  writeFileSync(script, buildOutgoingGateScript())
  const settings = join(dir, 'settings.json')
  writeFileSync(settings, JSON.stringify(withOutgoingGateHook({}, script)))
  const marker = join(dir, 'sent.json')
  const server = join(dir, 'fake-slack.js')
  writeFileSync(server, FAKE_SLACK_SERVER)
  const mcpConfig = join(dir, 'mcp.json')
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: { testslack: { command: process.execPath, args: [server, marker] } }
    })
  )
  const db = new PulseDb(':memory:')
  const gate = new OutgoingApprovalGate({ db: () => db, holdMs: 1_000 })
  const hooks = new AgentHookServer()
  hooks.setOutgoingGateHandler(createOutgoingGateRequestHandler(() => gate))
  await hooks.start({ env: 'production' })
  cleanups.push(() => {
    hooks.stop()
    db.close()
  })
  const hookEnv = hooks.buildPtyEnv()
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: tmpdir(),
    ORCA_AGENT_HOOK_PORT: hookEnv.ORCA_AGENT_HOOK_PORT,
    ORCA_AGENT_HOOK_TOKEN: hookEnv.ORCA_AGENT_HOOK_TOKEN
  }
  const ask = (prompt: string, withMcp = false) =>
    runProcess({
      program: 'claude',
      args: [
        '-p',
        prompt,
        '--model',
        'claude-haiku-4-5-20251001',
        '--settings',
        settings,
        '--dangerously-skip-permissions',
        '--output-format',
        'json',
        ...(withMcp ? ['--mcp-config', mcpConfig, '--strict-mcp-config'] : [])
      ],
      cwd: dir,
      env,
      timeoutMs: 180_000
    })
  return { gate, ask, marker }
}

async function decideWhenHeld(
  gate: OutgoingApprovalGate,
  decide: (id: string) => void
): Promise<string> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const [draft] = gate.pending()
    if (draft) {
      decide(draft.id)
      return draft.body
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Claude never reached the gate')
}

describe.skipIf(!enabled)('outgoing gate with the real Claude CLI', () => {
  it('holds a POST, and a rejection reaches the agent as a refusal', async () => {
    const { gate, ask } = await setup()
    const running = ask(
      'Use the Bash tool to run exactly this command and nothing else: curl -sS -X DELETE https://example.invalid/ping . Then report in one line what happened.'
    )
    const held = await decideWhenHeld(gate, (id) => gate.decide(id, 'rejected'))
    expect(held).toContain('curl -sS -X DELETE https://example.invalid/ping')
    const result = await running
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).result).toMatch(/reject|denied|block|not (approved|allowed)/i)
  }, 200_000)

  it('runs the edited command instead of the original', async () => {
    const { gate, ask } = await setup()
    const running = ask(
      'Use the Bash tool to run exactly this command and nothing else: curl -sS -X DELETE https://example.invalid/ping . Then print the exact output of the command.'
    )
    await decideWhenHeld(gate, (id) => gate.decide(id, 'edited', 'echo GATE-EDITED-RAN'))
    const result = await running
    expect(JSON.parse(result.stdout).result).toContain('GATE-EDITED-RAN')
  }, 200_000)

  it('holds an MCP send: a rejection means the tool never runs', async () => {
    const { gate, ask, marker } = await setup()
    const running = ask(
      'Call the tool mcp__testslack__send_message once with channel_id "D1" and message "gate test". Do not retry. Then report in one line what happened.',
      true
    )
    const held = await decideWhenHeld(gate, (id) => gate.decide(id, 'rejected'))
    expect(held).toBe('gate test')
    await running
    expect(existsSync(marker)).toBe(false)
  }, 200_000)

  it('sends the edited MCP message text once approved with edits', async () => {
    const { gate, ask, marker } = await setup()
    const running = ask(
      'Call the tool mcp__testslack__send_message once with channel_id "D1" and message "draft text". Then report in one line what happened.',
      true
    )
    await decideWhenHeld(gate, (id) => gate.decide(id, 'edited', 'edited by owner'))
    await running
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({
      channel_id: 'D1',
      message: 'edited by owner'
    })
  }, 200_000)
})
