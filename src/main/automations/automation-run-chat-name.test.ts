import { describe, expect, it, vi } from 'vitest'
import { nameAutomationRunChat } from './automation-run-chat-name'

describe('nameAutomationRunChat (custom build)', () => {
  it('names a fresh run chat after the run', async () => {
    const setMobileSessionTabProps = vi.fn(async () => ({ updated: true as const }))
    await nameAutomationRunChat(
      { setMobileSessionTabProps },
      { worktreeId: 'wt-1', outcome: { kind: 'structured', sessionId: 's', handle: 'h', tabId: 'tab-1' } },
      'Неделя: что улучшить run 2'
    )
    expect(setMobileSessionTabProps).toHaveBeenCalledWith('id:wt-1', {
      tabId: 'tab-1',
      customTitle: 'Неделя: что улучшить run 2'
    })
  })

  it('leaves terminals and tabless chats alone, and never throws', async () => {
    const setMobileSessionTabProps = vi.fn(async () => {
      throw new Error('window owns the layout')
    })
    await nameAutomationRunChat(
      { setMobileSessionTabProps },
      { worktreeId: 'wt-1', outcome: { kind: 'terminal', handle: 'h' } },
      'Run'
    )
    await nameAutomationRunChat(
      { setMobileSessionTabProps },
      { worktreeId: 'wt-1', outcome: { kind: 'structured', sessionId: 's', handle: 'h' } },
      'Run'
    )
    expect(setMobileSessionTabProps).not.toHaveBeenCalled()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      nameAutomationRunChat(
        { setMobileSessionTabProps },
        { worktreeId: 'wt-1', outcome: { kind: 'structured', sessionId: 's', handle: 'h', tabId: 't' } },
        'Run'
      )
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
