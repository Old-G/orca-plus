// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('../hq/HqCommandDictation', () => ({ HqCommandDictation: () => null }))

import { hqPlusClickUpRequestId, useHqPlusClickUpReply } from './use-hq-plus-clickup-reply'

afterEach(() => cleanup())

function item(id: string): PulseInboxItem {
  return {
    id: 'bell-1',
    kind: 'slack-request',
    title: 'Ann: a question',
    body: null,
    urgency: 'normal',
    refKind: 'slack-request',
    refId: JSON.stringify({ id, kind: 'answer', link: 'https://app.clickup.com/t/abc' }),
    actions: [],
    dedupeKey: null,
    createdAt: 0,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
}

describe('useHqPlusClickUpReply', () => {
  it('reads the request id of a ClickUp comment only', () => {
    expect(hqPlusClickUpRequestId(item('clickup:abc:1'))).toBe('clickup:abc:1')
    expect(hqPlusClickUpRequestId(item('C0HUB:1793.1'))).toBeNull()
  })

  it('opens the reply box in the card on Reply, and lets other buttons run as before', async () => {
    const draftClickUpReply = vi.fn(async () => ({ ok: true as const, text: 'Tonight.' }))
    Object.assign(window, { api: { hqProjects: { draftClickUpReply } } })
    let start: ((i: PulseInboxItem, action: string) => boolean) | null = null
    function Probe(): React.JSX.Element {
      const reply = useHqPlusClickUpReply(() => {})
      start = reply.start
      return <div>{reply.composer}</div>
    }
    render(<Probe />)
    expect(start!(item('clickup:abc:1'), 'slack-do')).toBe(false)
    expect(start!(item('C0HUB:1793.1'), 'slack-answer')).toBe(false)
    act(() => {
      expect(start!(item('clickup:abc:1'), 'slack-answer')).toBe(true)
    })
    await waitFor(() => expect(screen.getByDisplayValue('Tonight.')).toBeTruthy())
    expect(draftClickUpReply).toHaveBeenCalledWith({ id: 'clickup:abc:1' })
  })
})
