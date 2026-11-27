import { describe, expect, it, vi } from 'vitest'
import type { HqIntake } from '../../shared/hq-slack-intake'
import { hqNewMarkPrompt, startHqNewMarkChat, type HqNewMarkChatDeps } from './hq-new-mark-chat'

const intake: HqIntake = {
  channel: 'C1',
  ts: '100.000001',
  threadTs: '90.000001',
  author: 'Ann',
  authorSlackId: 'U1',
  venue: 'channel',
  text: 'Please add the Acme export',
  links: [],
  files: [],
  permalink: 'https://acme.example/archives/C1/p100000001',
  at: 1_800_000_000_000,
  newMark: true,
  repoId: 'r1',
  project: 'acme',
  summary: 'Export'
}

function deps(extra: Partial<HqNewMarkChatDeps> = {}): HqNewMarkChatDeps {
  return {
    workspaceFor: () => ({ worktreeId: 'w1', name: 'Acme' }),
    launch: vi.fn(async () => ({ ok: true as const, sessionId: 'new-chat' })),
    limit: vi.fn(async () => true),
    deliver: vi.fn(async () => true),
    bind: vi.fn(),
    ...extra
  }
}

describe('startHqNewMarkChat', () => {
  it('starts a chat in the project, sends author, link and text, binds the thread', async () => {
    const d = deps()
    expect(await startHqNewMarkChat(intake, d)).toBe(true)
    expect(d.launch).toHaveBeenCalledWith('w1')
    const [, prompt] = vi.mocked(d.deliver).mock.calls[0]
    expect(prompt).toContain('Ann')
    expect(prompt).toContain('https://acme.example/archives/C1/p100000001')
    expect(prompt).toContain('Please add the Acme export')
    expect(prompt).toContain('🆕')
    expect(d.bind).toHaveBeenCalledWith(intake, 'new-chat')
  })
  it('the message goes in only after the chat is held to Auto', async () => {
    const d = deps({ limit: vi.fn(async () => false) })
    expect(await startHqNewMarkChat(intake, d)).toBe(false)
    expect(d.deliver).not.toHaveBeenCalled()
    expect(d.bind).not.toHaveBeenCalled()
  })
  it('binds nothing when the project has no workspace, the launch fails or delivery fails', async () => {
    for (const d of [
      deps({ workspaceFor: () => null }),
      deps({ launch: vi.fn(async () => ({ ok: false as const, error: 'x' })) }),
      deps({ deliver: vi.fn(async () => false) }),
      deps({
        launch: vi.fn(async () => {
          throw new Error('boom')
        })
      })
    ]) {
      expect(await startHqNewMarkChat(intake, d)).toBe(false)
      expect(d.bind).not.toHaveBeenCalled()
    }
  })
  it('names the project in the first line, HQ-less cards use the workspace name', () => {
    expect(hqNewMarkPrompt(intake, 'acme')).toContain('(project acme)')
  })
})
