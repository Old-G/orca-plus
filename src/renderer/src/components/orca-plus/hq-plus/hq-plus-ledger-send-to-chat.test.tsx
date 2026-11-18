// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import type { HqPlusLogContext } from './HqPlusLog'

const mocks = vi.hoisted(() => ({
  call: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  send: vi.fn(async (_route: unknown, _prompt: string) => true)
}))
vi.mock('./use-hq-plus-data', () => ({ hqPlusCall: mocks.call }))
vi.mock('../pulse-bell/hq-route-send', () => ({ sendHqRoutePrompt: mocks.send }))

import { HqPlusLedgerOnlyButtons } from './HqPlusLedgerOnlyButtons'

const MR = 'gitlab:acme/app!7'

function card(): HqPlusCard {
  return {
    id: `conv:${MR}`,
    sessionId: 'claude_1',
    project: 'app',
    conversation: {
      key: MR,
      title: 'MR !7',
      ledgerState: 'you',
      messages: [{ direction: 'in', author: 'Bob', text: 'old comment', link: null, at: 1 }]
    }
  } as unknown as HqPlusCard
}

const ctx = { onChanged: vi.fn(), toWork: () => {} } as unknown as HqPlusLogContext

afterEach(() => {
  cleanup()
  mocks.call.mockReset()
  mocks.send.mockClear()
})

describe('«Send to chat» on a stale MR card', () => {
  it('sends nothing when the main side says no comment is owed anymore', async () => {
    mocks.call.mockImplementation(async (method) =>
      method === 'hq.conversationUnsent' ? { ok: true, result: { messages: [] } } : { ok: true }
    )
    render(
      <HqPlusLedgerOnlyButtons
        card={card()}
        link={null}
        chat={{
          item: { worktreeId: 'wt', worktreeName: 'app' } as never,
          name: 'app'
        }}
        ctx={ctx}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send to chat/ }))
    })
    expect(mocks.call).toHaveBeenCalledWith('hq.conversationUnsent', { key: MR })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalledWith('hq.conversationDone', expect.anything())
  })
})
