import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  launch: vi.fn((): object | null => ({ surface: { kind: 'host-published' } })),
  newPane: vi.fn(async (): Promise<string | null> => 'tab-new:11111111-1111-4111-8111-111111111111'),
  open: vi.fn(),
  error: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/agent-launch-request-id', () => ({ newAgentLaunchRequestId: () => 'req-1' }))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: mocks.launch }))
vi.mock('./hq-chat-open', () => ({ openChatInShownHq: mocks.open }))
vi.mock('./hq-today-actions', () => ({
  agentPaneKeys: () => new Set(['tab-old:leaf-1']),
  waitForNewAgentPane: mocks.newPane
}))

import { startHqChat } from './hq-new-chat'

beforeEach(() => vi.clearAllMocks())

describe('startHqChat', () => {
  it('starts Claude in the workspace and opens its new chat in HQ', async () => {
    await startHqChat('wt-1')
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', worktreeId: 'wt-1' })
    )
    expect(mocks.newPane).toHaveBeenCalledWith('wt-1', new Set(['tab-old:leaf-1']))
    expect(mocks.open).toHaveBeenCalledWith('wt-1', 'tab-new')
  })

  it('says so when nothing could be launched', async () => {
    mocks.launch.mockReturnValueOnce(null)
    await startHqChat('wt-1')
    expect(mocks.error).toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
