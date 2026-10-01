import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { openTestAgentSessionRecordStore } from './agent-session-record-store-test-harness'

const NOW = 1_800_000_000_000
const SESSION = 'session-account-home'
const PERSONAL = { variable: 'CLAUDE_CONFIG_DIR' as const, path: '/home/u/.claude' }
const WORK = { variable: 'CLAUDE_CONFIG_DIR' as const, path: '/home/u/.claude-work' }
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-agent-session-account-home-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** A Claude chat whose child is proven: the lease is live at the returned fence. */
async function liveChat(store: AgentSessionRecordStore): Promise<number> {
  const reserved = await store.reserveOwner({
    sessionId: SESSION,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'claude',
    accountHome: PERSONAL,
    expectedFence: null,
    spawnToken: 'spawn-1',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'indeterminate', reason: 'new session' },
    operation: {
      callerKey: 'client-1',
      operationId: '1800000000000-00000000000000000000000000000000',
      fingerprint: 'account-home-create'
    },
    now: NOW
  })
  const fence = reserved.record.lease.runtimeFence
  await store.commitProcessIdentity({
    sessionId: SESSION,
    fence,
    process: { hostId: 'local', pid: 4242, processStartTimeMs: NOW - 1, spawnToken: 'spawn-1' },
    now: NOW
  })
  await store.proveOwner({
    sessionId: SESSION,
    fence,
    link: {
      linkId: 'claude-1',
      handle: { provider: 'claude', sessionId: 'claude-uuid-1', leafUuid: null },
      origin: 'created',
      mintedAtFence: fence,
      observedAt: NOW
    },
    now: NOW
  })
  return fence
}

async function chatAtRest(store: AgentSessionRecordStore): Promise<number> {
  const fence = await liveChat(store)
  const evicted = await store.evictProvenDeadOwner({
    sessionId: SESSION,
    expectedFence: fence,
    probe: { outcome: 'exit-observed' },
    now: NOW + 1
  })
  return evicted.lease.runtimeFence
}

it('moves a chat at rest to another subscription and keeps its conversation', async () => {
  const store = await openTestAgentSessionRecordStore(directory)
  const fence = await chatAtRest(store)
  const before = store.getRecord(SESSION)

  await store.replaceSessionAccountHome({
    sessionId: SESSION,
    fence,
    accountHome: WORK,
    now: NOW + 2
  })

  const reopened = await openTestAgentSessionRecordStore(directory)
  const after = reopened.getRecord(SESSION)
  expect(after?.accountHome).toEqual(WORK)
  expect(after?.providerHandleChain).toEqual(before?.providerHandleChain)
  expect(after?.lease.runtimeFence).toBe(fence)
})

it('refuses while a child holds the lease', async () => {
  const store = await openTestAgentSessionRecordStore(directory)
  const fence = await liveChat(store)
  await expect(
    store.replaceSessionAccountHome({ sessionId: SESSION, fence, accountHome: WORK, now: NOW + 2 })
  ).rejects.toThrow('agent_session_ownership_unknown')
  expect(store.getRecord(SESSION)?.accountHome).toEqual(PERSONAL)
})

it('refuses a fence the lease has moved past', async () => {
  const store = await openTestAgentSessionRecordStore(directory)
  const fence = await chatAtRest(store)
  await expect(
    store.replaceSessionAccountHome({
      sessionId: SESSION,
      fence: fence - 1,
      accountHome: WORK,
      now: NOW + 2
    })
  ).rejects.toThrow('agent_session_ownership_unknown')
})
