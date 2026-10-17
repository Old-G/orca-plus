import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const settings: { hqAskSessionId: string | null } = { hqAskSessionId: null }
  const targets: Record<string, unknown>[] = []
  return {
    settings,
    targets,
    updateSettings: vi.fn(async () => undefined),
    launch: vi.fn(() => true),
    send: vi.fn(async () => ({ ok: true }) as const),
    waitForPane: vi.fn(async () => 'tab-new:leaf'),
    openShown: vi.fn(() => true),
    openHqChat: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ settings: mocks.settings, updateSettings: mocks.updateSettings })
  }
}))
vi.mock('@/lib/running-agent-targets', () => ({
  deriveRunningAgentSendTargets: () => mocks.targets,
  deriveStatuslessStructuredAgentSendTargets: () => []
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: mocks.launch }))
vi.mock('./hq-today-actions', () => ({
  agentPaneKeys: () => new Set<string>(),
  sendHqAgentMessage: mocks.send,
  waitForNewAgentPane: mocks.waitForPane
}))
vi.mock('./hq-chat-open', () => ({
  openChatInShownHq: mocks.openShown,
  openHqChat: mocks.openHqChat
}))

import { HQ_STATUS_UPDATE_PROMPT, askHq, startHqStatusUpdate } from './hq-ask-chat'

const chat = (sessionId: string, paneKey: string, tabId: string) => ({
  kind: 'structured-session',
  status: 'eligible',
  sessionId,
  paneKey,
  tabId
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.hqAskSessionId = null
  mocks.targets.length = 0
})

describe('askHq', () => {
  it('starts the standing chat with the skill named, remembers it and shows it in HQ', async () => {
    mocks.targets.push(chat('s-new', 'tab-new:leaf', 'tab-new'))
    await expect(askHq('wt-hq', '  что решили про возвраты? ')).resolves.toEqual({ ok: true })
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'wt-hq',
        prompt: 'Спроси HQ (скилл ask-hq): что решили про возвраты?'
      })
    )
    expect(mocks.updateSettings).toHaveBeenCalledWith({ hqAskSessionId: 's-new' })
    expect(mocks.openShown).toHaveBeenCalledWith('wt-hq', 'tab-new')
  })

  it('sends later questions to the same chat instead of starting another', async () => {
    mocks.settings.hqAskSessionId = 's-ask'
    mocks.targets.push(chat('s-other', 'tab-o:leaf', 'tab-o'), chat('s-ask', 'tab-a:leaf', 'tab-a'))
    await askHq('wt-hq', 'а что Женя ответила?')
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledWith(
      { paneKey: 'tab-a:leaf', worktreeId: 'wt-hq' },
      'а что Женя ответила?'
    )
    expect(mocks.openShown).toHaveBeenCalledWith('wt-hq', 'tab-a')
  })

  it('starts a new chat when the remembered one was closed, and opens HQ on chats if needed', async () => {
    mocks.settings.hqAskSessionId = 's-gone'
    mocks.openShown.mockReturnValueOnce(false)
    mocks.targets.push(chat('s-new', 'tab-new:leaf', 'tab-new'))
    await askHq('wt-hq', 'кто ждёт от меня ответа?')
    expect(mocks.launch).toHaveBeenCalledOnce()
    expect(mocks.openHqChat).toHaveBeenCalledOnce()
  })
})

describe('startHqStatusUpdate', () => {
  it('opens a fresh HQ chat with the status-update skill and leaves the Ask HQ chat alone', async () => {
    mocks.targets.push(chat('s-status', 'tab-new:leaf', 'tab-new'))
    await expect(startHqStatusUpdate('wt-hq')).resolves.toEqual({ ok: true })
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-hq', prompt: HQ_STATUS_UPDATE_PROMPT })
    )
    expect(HQ_STATUS_UPDATE_PROMPT).toContain('status-update')
    expect(mocks.updateSettings).not.toHaveBeenCalled()
    expect(mocks.openShown).toHaveBeenCalledWith('wt-hq', 'tab-new')
  })
})
