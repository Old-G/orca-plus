// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import type { NativeChatContinueNew } from '../../usage/native-chat-continue-new-context'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = vi.hoisted(() => ({
  call: vi.fn<(target: unknown, method: string, params: unknown) => Promise<unknown>>()
}))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/native-chat/requests/structured-agent-session-call', () => ({
  callStructuredAgentSession: calls.call
}))
vi.mock('@/runtime/native-chat/host-capabilities/structured-agent-session-host-support', () => ({
  supportsStructuredAgentSessionContinuationContext: async () => true
}))
vi.mock('@/lib/workspace/activation/worktree-activation', () => ({
  activateAndRevealWorktree: vi.fn()
}))
vi.mock('@/components/orca-plus/hq/hq-chat-open', () => ({ openChatInShownHq: () => true }))

const { useNativeChatContinueNew } = await import('./use-native-chat-continue-new')

let container: HTMLDivElement
let root: Root
let offer: NativeChatContinueNew | null
const continueChat = vi.fn(async () => ({ ok: true, worktreeId: 'wt', tabId: 'tab' }))
const messages = [{ timestamp: Date.now() - 3 * 60 * 60_000 }] as unknown as NativeChatMessage[]

function Harness({ isWorking }: { isWorking: boolean }): null {
  offer = useNativeChatContinueNew({
    pane: { sessionId: 'claude_1', target: { kind: 'local' } as never, agent: 'claude' },
    directory: { worktreeId: 'wt', worktreePath: '/repo' } as never,
    messages,
    epoch: 'epoch-1',
    usedTokens: 420_000,
    isWorking,
    available: true
  })
  return null
}

function render(isWorking: boolean): void {
  act(() => {
    root.render(<Harness isWorking={isWorking} />)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  root = createRoot(container)
  calls.call.mockReset()
  continueChat.mockClear()
  ;(window as unknown as { api: unknown }).api = { claudeHandoff: { continueChat } }
})

afterEach(() => {
  act(() => root.unmount())
})

describe('Continue in new chat', () => {
  it('stays put when the chat starts working while its options are read', async () => {
    let resolveOptions: (value: unknown) => void = () => {}
    calls.call.mockImplementation(async (_target, method) =>
      method === 'agentSession.options'
        ? new Promise((resolve) => {
            resolveOptions = resolve
          })
        : { status: 'current', capturedText: 'context', transcriptPath: '/t.jsonl' }
    )
    render(false)
    const start = offer!.start
    let started: Promise<boolean> = Promise.resolve(true)
    act(() => {
      started = start()
    })
    await vi.waitFor(() =>
      expect(calls.call).toHaveBeenCalledWith(expect.anything(), 'agentSession.options', {
        sessionId: 'claude_1'
      })
    )
    render(true)
    await act(async () => {
      resolveOptions({ current: { model: 'opus', effort: 'medium' } })
      await started
    })
    expect(await started).toBe(false)
    expect(continueChat).not.toHaveBeenCalled()
  })
})
