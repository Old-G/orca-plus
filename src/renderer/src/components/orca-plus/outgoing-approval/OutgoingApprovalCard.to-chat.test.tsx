// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { NO_OUTGOING_APPROVAL_OPTIONS } from '../../../../../shared/outgoing-approval/outgoing-approval-options'
import { OutgoingApprovalDecision } from './OutgoingApprovalCard'

vi.mock('../hq/use-hq-spaces', () => ({
  useHqSpaces: () => ({ spaces: [] }),
  hqSpaceStripeStyle: () => undefined
}))
vi.mock('./use-outgoing-approval-options', () => ({
  useOutgoingApprovalOptions: () => NO_OUTGOING_APPROVAL_OPTIONS
}))

const decide = vi.fn(() => Promise.resolve())

const item: PulseInboxItem = {
  id: 'inbox-1',
  kind: 'decision',
  title: 'Approve an outgoing action',
  body: 'Slack · #general · acme\nHello Ann',
  urgency: 'urgent',
  refKind: 'outgoing-approval',
  refId: 'draft-1',
  actions: [],
  dedupeKey: null,
  createdAt: Date.now(),
  readAt: null,
  doneAt: null,
  doneAction: null
}

beforeEach(() => {
  vi.stubGlobal('api', { outgoingApproval: { decide } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  decide.mockClear()
})

it('shows «To chat» only when the asking chat can be opened', () => {
  render(<OutgoingApprovalDecision item={item} />)
  expect(screen.queryByRole('button', { name: 'To chat' })).toBeNull()
  cleanup()

  render(<OutgoingApprovalDecision item={item} onOpenChat={null} />)
  expect(screen.queryByRole('button', { name: 'To chat' })).toBeNull()
})

it('opens the chat and decides nothing', () => {
  const onOpenChat = vi.fn()
  render(<OutgoingApprovalDecision item={item} onOpenChat={onOpenChat} />)
  const names = screen.getAllByRole('button').map((button) => button.textContent)
  expect(names).toEqual(['Approve', 'Reject', 'To chat'])

  fireEvent.click(screen.getByRole('button', { name: 'To chat' }))
  expect(onOpenChat).toHaveBeenCalledTimes(1)
  expect(decide).not.toHaveBeenCalled()
})
