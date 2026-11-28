// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import type { OutgoingApprovalOptions } from '../../../../../shared/outgoing-approval/outgoing-approval-options'
import { OutgoingApprovalDecision } from './OutgoingApprovalCard'

vi.mock('../hq/use-hq-spaces', () => ({
  useHqSpaces: () => ({ spaces: [], stripeOf: () => null }),
  hqSpaceStripeStyle: () => undefined
}))

let options: OutgoingApprovalOptions
vi.mock('./use-outgoing-approval-options', () => ({
  useOutgoingApprovalOptions: () => options
}))

const openUrl = vi.fn((..._args: unknown[]) => Promise.resolve())

const item: PulseInboxItem = {
  id: 'inbox-1',
  kind: 'decision',
  title: 'Approve an outgoing action',
  body: 'Slack · send message → #acme-hub · in a thread · from «Docs»\nYes, read access until Friday.',
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
  vi.stubGlobal('api', { outgoingApproval: { decide: vi.fn() }, shell: { openUrl } })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { outgoingApproval: { decide: vi.fn() }, shell: { openUrl } }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  openUrl.mockClear()
})

it('shows the whole message the draft answers above the draft: who, where, text, link', () => {
  options = {
    footer: null,
    move: null,
    threads: [],
    source: {
      author: 'Ann',
      where: '#acme-hub',
      at: Date.now() - 60_000,
      text: 'Can we read orders_view until Friday?\nFor the November returns report.',
      link: 'https://acme.example/p1'
    }
  }
  render(<OutgoingApprovalDecision item={item} />)
  const block = screen.getByLabelText('What came in')
  expect(block).toHaveTextContent('Ann · #acme-hub')
  expect(block).toHaveTextContent('For the November returns report.')
  const draft = screen.getByText('Yes, read access until Friday.')
  // the block sits before the draft in the card
  expect(block.compareDocumentPosition(draft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByLabelText('Open the message'))
  expect(openUrl).toHaveBeenCalledWith('https://acme.example/p1')
})

it('shows no block, and no link button, when nothing came in', () => {
  options = { footer: null, move: null, threads: [], source: null }
  render(<OutgoingApprovalDecision item={item} />)
  expect(screen.queryByLabelText('What came in')).toBeNull()
})
