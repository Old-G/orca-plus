// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

const toast = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('../pulse-bell/pulse-bell-actions', () => ({ runPulseBellAction: vi.fn() }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

const { createHqSlackRequestToastMemory, syncHqSlackRequestToasts } =
  await import('./hq-slack-request-toasts')

const item = (id: string, kind: string, createdAt: number): PulseInboxItem => ({
  id,
  kind: 'slack-request',
  title: 'Ирина: проверь тикеты',
  body: 'Reply · project? · DM Ирина',
  urgency: 'normal',
  refKind: 'slack-request',
  refId: JSON.stringify({ id: `D:${id}`, kind }),
  actions: [],
  dedupeKey: `slack-request:D:${id}`,
  createdAt,
  readAt: null,
  doneAt: null,
  doneAction: null
})

afterEach(() => vi.clearAllMocks())

describe('Slack request toasts', () => {
  it('pops a request that arrives after launch, not the ones raised at launch or an FYI', () => {
    const memory = createHqSlackRequestToastMemory(1_000)
    syncHqSlackRequestToasts([item('old', 'do', 30_000)], memory)
    expect(toast.custom).not.toHaveBeenCalled()
    syncHqSlackRequestToasts(
      [item('old', 'do', 30_000), item('new', 'answer', 120_000), item('fyi', 'fyi', 120_000)],
      memory
    )
    expect(toast.custom).toHaveBeenCalledTimes(1)
    expect(toast.custom.mock.calls[0]![1]).toMatchObject({ id: 'slack-request-toast-new' })
  })

  it('closes the toast once the request is decided anywhere', () => {
    const memory = createHqSlackRequestToastMemory(0)
    syncHqSlackRequestToasts([item('a', 'do', 120_000)], memory)
    syncHqSlackRequestToasts([], memory)
    expect(toast.dismiss).toHaveBeenCalledWith('slack-request-toast-a')
  })

  it('does not pop a request again when its correction replaces the item', () => {
    const memory = createHqSlackRequestToastMemory(0)
    syncHqSlackRequestToasts([item('a', 'do', 120_000)], memory)
    const corrected = {
      ...item('a2', 'do', 130_000),
      refId: JSON.stringify({ id: 'D:a', kind: 'do' })
    }
    syncHqSlackRequestToasts([corrected], memory)
    expect(toast.custom).toHaveBeenCalledTimes(1)
  })

  it('shows at most three at once; the rest wait in the bell', () => {
    const memory = createHqSlackRequestToastMemory(0)
    syncHqSlackRequestToasts(
      ['a', 'b', 'c', 'd'].map((id) => item(id, 'do', 120_000)),
      memory
    )
    expect(toast.custom).toHaveBeenCalledTimes(3)
  })
})
