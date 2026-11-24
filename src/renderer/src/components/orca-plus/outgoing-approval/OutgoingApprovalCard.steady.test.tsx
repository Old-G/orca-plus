// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { OutgoingApprovalDecision } from './OutgoingApprovalCard'
import { STEADY_SETTLE_MS } from './use-steady-click'

vi.mock('../hq/use-hq-spaces', () => ({
  useHqSpaces: () => ({ spaces: [] }),
  hqSpaceStripeStyle: () => undefined
}))
// The venue loaded at once, so the card has the button that took the misclick (owner, 24.11).
vi.mock('./use-outgoing-approval-options', () => ({
  useOutgoingApprovalOptions: () => ({
    footer: null,
    move: { to: 'clickup', task: { id: 'TASK-1', name: 'A task' } },
    threads: []
  })
}))

const decide = vi.fn((..._args: unknown[]) => Promise.resolve())

const item: PulseInboxItem = {
  id: 'inbox-1',
  kind: 'decision',
  title: 'Approve an outgoing action',
  body: 'Slack · DM · acme\nHello Ann',
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

/** Where each element sits on screen; the test moves them as a jumping card would. */
const tops = new Map<Element, number>()
let now = 10_000

beforeEach(() => {
  vi.stubGlobal('api', { outgoingApproval: { decide } })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = tops.get(this) ?? 0
    return {
      top,
      left: 0,
      right: 80,
      bottom: top + 30,
      width: 80,
      height: 30,
      x: 0,
      y: top,
      toJSON: () => ({})
    }
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  decide.mockClear()
  tops.clear()
})

function setup(): { approve: HTMLElement; move: HTMLElement } {
  render(<OutgoingApprovalDecision item={item} />)
  const approve = screen.getByRole('button', { name: 'Approve' })
  const move = screen.getByRole('button', { name: /Ask in TASK-1 instead/ })
  tops.set(approve, 300)
  tops.set(move, 360)
  return { approve, move }
}

const mouseClick = (element: HTMLElement): void => {
  fireEvent.click(element, { detail: 1 })
}

it('takes a click on the button the pointer moved onto', () => {
  const { approve } = setup()
  fireEvent.pointerMove(approve)
  now += 300
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(decide.mock.calls[0]?.[1]).toBe('approved')
  expect(decide.mock.calls[0]?.[3]).not.toHaveProperty('moveTo')
})

it('holds a click on a button that slid under a resting pointer', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(approve)
  // The card jumps up: «Ask in … instead» now sits where Approve was.
  tops.set(approve, 240)
  tops.set(move, 300)
  now += 300
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('nothing was sent')
})

it('holds a click on a button that moved after the pointer last moved', () => {
  const { approve } = setup()
  fireEvent.pointerMove(approve)
  tops.set(approve, 260)
  now += 300
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()
})

it('holds a quick click after a jitter landed on the slid-in button, and takes it once settled', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(approve)
  tops.set(approve, 240)
  tops.set(move, 300)
  now += 50
  fireEvent.pointerMove(move)
  now += 100
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()

  now += STEADY_SETTLE_MS
  fireEvent.pointerMove(move)
  mouseClick(move)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(decide.mock.calls[0]?.[3]).toMatchObject({ moveTo: 'clickup' })
})

it('holds a click on a card that appeared under a pointer that never moved', () => {
  const { approve } = setup()
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()
})

it('takes a key press on a focused button whatever moved', () => {
  const { approve } = setup()
  tops.set(approve, 120)
  fireEvent.click(approve, { detail: 0 })
  expect(decide).toHaveBeenCalledTimes(1)
})

it('takes a tap: a finger lands on what is there now', () => {
  const { approve } = setup()
  fireEvent.pointerDown(approve, { pointerType: 'touch' })
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
})

it('does not count a mouse press as aiming', () => {
  const { approve } = setup()
  fireEvent.pointerDown(approve, { pointerType: 'mouse' })
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()
})

it("takes a click on what the owner's own scroll brought under the pointer", () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(approve, { clientX: 10, clientY: 310 })
  tops.set(approve, 240)
  tops.set(move, 300)
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(move)
  fireEvent.wheel(document)
  fireEvent.scroll(document)
  now += 300
  mouseClick(move)
  expect(decide).toHaveBeenCalledTimes(1)
})
