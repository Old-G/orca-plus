// Custom build (context-diet T1): only a lead and a chat without a role keep Claude's Artifact tool.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../../native-chat/testing/agent-session-record-test-fixture'
import { createClaudeStructuredLaunchResolver } from '../../../runtime/agent-session/launch/structured-agent-launch-composition.test-support'
import { bindChatRoleLookup } from '../../../orca-plus/chat-roles/chat-role-env'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host/execution-host'
import type { HqChatRole } from '../../../../shared/hq-chat-role'

afterEach(() => bindChatRoleLookup(null))

async function launchAs(role: HqChatRole | null) {
  bindChatRoleLookup(() => role)
  const identity = { sessionId: 's1' } as Parameters<
    ReturnType<typeof createClaudeStructuredLaunchResolver>
  >[0]['identity']
  return createClaudeStructuredLaunchResolver({
    store: {
      getRecord: () =>
        agentSessionRecordFixture({
          sessionId: 's1',
          provider: 'claude',
          location: {
            executionHostId: LOCAL_EXECUTION_HOST_ID,
            wslDistro: null,
            workspaceId: 'workspace-1',
            workspaceKind: 'folder'
          },
          accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/work/.claude' },
          providerHandleChain: []
        }),
      pinLaunchDirectory: vi.fn()
    },
    resolveWorkspacePath: async (id) => `/repos/${id}`,
    resolveCommand: () => ({ command: '/usr/local/bin/claude', prefixArgs: [] }),
    resolveAuthPolicy: () => ({ account: 'system' }),
    hasTranscript: async () => true,
    resolveLaunchArgs: () => []
  })({ identity })
}

describe('claude launch — Artifact by chat role (custom build)', () => {
  it.each(['worker', 'review', 'sublead'] as const)(
    'turns Artifact off in the launch settings of a %s chat',
    async (role) => {
      expect((await launchAs(role)).options.settings).toEqual({
        env: { CLAUDE_CODE_ARTIFACT: '0' }
      })
    }
  )

  it.each(['lead', null] as const)('leaves Artifact alone for %s', async (role) => {
    expect((await launchAs(role)).options).not.toHaveProperty('settings')
  })
})
