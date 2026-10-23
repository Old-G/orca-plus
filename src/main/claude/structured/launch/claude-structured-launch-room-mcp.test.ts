// Custom build (hq-plus-room-mcp): a chat starts without the MCP servers its room hides.
import { agentSessionRecordFixture } from '../../../native-chat/testing/agent-session-record-test-fixture'
import { createClaudeStructuredLaunchResolver } from '../../../runtime/agent-session/launch/structured-agent-launch-composition.test-support'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

const SESSION_ID = 'orca-session-1'
const IDENTITY = { sessionId: SESSION_ID } as Parameters<
  ReturnType<typeof createClaudeStructuredLaunchResolver>
>[0]['identity']

function record(): AgentSessionRecord {
  return agentSessionRecordFixture({
    sessionId: SESSION_ID,
    provider: 'claude',
    location: {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/work/.claude' },
    providerHandleChain: []
  })
}

describe('claude structured launch — room MCP (custom build)', () => {
  it("starts a chat without the tools its room hides, and with all of them when the room can't say", async () => {
    const launchWith = (resolveDeniedTools: () => Promise<readonly string[]>) =>
      createClaudeStructuredLaunchResolver({
        store: { getRecord: () => record(), pinLaunchDirectory: vi.fn() },
        resolveWorkspacePath: async (id) => `/repos/${id}`,
        resolveCommand: () => ({ command: '/usr/local/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' }),
        hasTranscript: async () => true,
        resolveLaunchArgs: () => [],
        resolveDeniedTools
      })({ identity: IDENTITY })
    const asked = vi.fn(async () => ['mcp__acme_crm', 'mcp__claude_ai_Acme*'])

    expect((await launchWith(asked)).options.disallowedTools).toEqual([
      'mcp__acme_crm',
      'mcp__claude_ai_Acme*'
    ])
    expect(asked).toHaveBeenCalledWith({ sessionId: SESSION_ID, cwd: '/repos/workspace-1' })
    expect((await launchWith(async () => [])).options).not.toHaveProperty('disallowedTools')
    expect(
      (await launchWith(() => Promise.reject(new Error('unreadable')))).options
    ).not.toHaveProperty('disallowedTools')
    vi.useFakeTimers()
    try {
      const slow = launchWith(() => new Promise<readonly string[]>(() => {}))
      await vi.advanceTimersByTimeAsync(2_000)
      expect((await slow).options).not.toHaveProperty('disallowedTools')
    } finally {
      vi.useRealTimers()
    }
  })
})
