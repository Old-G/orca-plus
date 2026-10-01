// Custom build (claude-subscriptions): a chat that stopped on one subscription continues on another —
// the same record, journal and Claude conversation, the next child under the other config dir.
// Against the production runtime, adapter, record store and host, with only the CLI scripted.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import { claudeSessionIdForOrcaSession } from '../claude/claude-structured-launch-resolution'
import { hostTestMessage } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { createScriptedClaudeRuntime } from './structured-claude-scripted-runtime-test-support'

const SESSION = 'claude-account-home-switch'
const PROVIDER_SESSION = claudeSessionIdForOrcaSession(SESSION)
const CALLER = { callerKey: 'client-1' }

let claude = createScriptedClaudeRuntime([SESSION])
let operations = 0
let otherHome: string

beforeEach(async () => {
  otherHome = await mkdtemp(join(tmpdir(), 'orca-claude-other-subscription-'))
  await mkdir(join(otherHome, 'projects'), { recursive: true })
})

afterEach(async () => {
  await claude.dispose()
  claude = createScriptedClaudeRuntime([SESSION])
  await rm(otherHome, { recursive: true, force: true })
})

function record(host: StructuredAgentSessionHost) {
  const found = host.deps.store.getRecord(SESSION)
  if (!found) {
    throw new Error('no record')
  }
  return found
}

async function send(host: StructuredAgentSessionHost, text: string): Promise<void> {
  const body = hostTestMessage(text)
  const sent = await host.send(CALLER, {
    envelope: {
      sessionId: SESSION,
      clientOperationId: `${Date.now()}-${(++operations).toString(16).padStart(32, '0')}`,
      expectedRuntimeFence: record(host).lease.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: SESSION,
        fields: { body }
      })
    },
    body
  })
  expect(sent, JSON.stringify(sent)).toMatchObject({ ok: true })
}

function finishTurn(host: StructuredAgentSessionHost, leaf: string): Promise<void> {
  const child = claude.child(SESSION)
  child.handlers.onMessage?.({
    type: 'assistant',
    session_id: PROVIDER_SESSION,
    uuid: leaf,
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }
  })
  child.handlers.onMessage?.({
    type: 'result',
    subtype: 'success',
    session_id: PROVIDER_SESSION,
    uuid: `${leaf}-result`
  })
  return host.flushStreamedEvents(SESSION)
}

/** Claude echoes each accepted user message; without it a settled turn reads as unanswered. */
function echoSends(): void {
  const child = claude.child(SESSION)
  child.connection.send = async (message, beforeDispatch) => {
    await beforeDispatch?.()
    child.calls.push('send')
    if (message.type === 'user') {
      child.handlers.onMessage?.({ ...message, uuid: `user-${child.calls.length}` })
    }
  }
}

async function startedChat(): Promise<StructuredAgentSessionHost> {
  const host = await claude.install()
  await expect(host.attach(CALLER, claude.attachParams(SESSION, null))).resolves.toMatchObject({
    ok: true
  })
  echoSends()
  await send(host, 'first')
  await vi.waitFor(() => expect(claude.child(SESSION).calls).toContain('send'))
  await finishTurn(host, 'assistant-1')
  await vi.waitFor(() =>
    expect(record(host).providerHandleChain.at(-1)?.handle).toMatchObject({
      resumeCursor: 'assistant-1'
    })
  )
  return host
}

describe('a Claude chat moved to another subscription', () => {
  it('puts its child to rest and resumes the same conversation under the other dir', async () => {
    const host = await startedChat()
    const first = claude.child(SESSION)
    const chainBefore = record(host).providerHandleChain

    await expect(
      host.lifetime.switchAccountHome(SESSION, { variable: 'CLAUDE_CONFIG_DIR', path: otherHome })
    ).resolves.toEqual({ ok: true })
    expect(first.connection.closed).toBe(true)
    expect(record(host).accountHome.path).toBe(otherHome)
    expect(record(host).lease).toMatchObject({ claimStatus: 'released', ownerProcess: null })
    expect(record(host).providerHandleChain).toEqual(chainBefore)

    await send(host, 'continue')
    await vi.waitFor(() => expect(claude.children(SESSION)).toHaveLength(2))
    const resumed = claude.child(SESSION)
    expect(resumed).not.toBe(first)
    expect(resumed.launch.options).toMatchObject({ resume: PROVIDER_SESSION })
    expect(resumed.launch.env?.CLAUDE_CONFIG_DIR).toBe(otherHome)
    await vi.waitFor(() => expect(resumed.calls).toContain('send'))
    expect(first.launch.env?.CLAUDE_CONFIG_DIR).not.toBe(otherHome)
  })

  it('refuses while a turn is running and leaves the child alone', async () => {
    const host = await startedChat()
    await send(host, 'second')
    await vi.waitFor(() =>
      expect(claude.child(SESSION).calls.filter((call) => call === 'send')).toHaveLength(2)
    )
    claude.child(SESSION).handlers.onMessage?.({
      type: 'assistant',
      session_id: PROVIDER_SESSION,
      uuid: 'assistant-2',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Working…' }] }
    })
    await host.flushStreamedEvents(SESSION)

    await expect(
      host.lifetime.switchAccountHome(SESSION, { variable: 'CLAUDE_CONFIG_DIR', path: otherHome })
    ).resolves.toEqual({ ok: false, reason: 'busy' })
    expect(claude.child(SESSION).connection.closed).toBe(false)
    expect(record(host).accountHome.path).not.toBe(otherHome)
  })

  it('refuses a move to the dir it already runs under', async () => {
    const host = await startedChat()
    await expect(
      host.lifetime.switchAccountHome(SESSION, record(host).accountHome)
    ).resolves.toEqual({
      ok: false,
      reason: 'sameHome'
    })
    expect(claude.child(SESSION).connection.closed).toBe(false)
  })
})
