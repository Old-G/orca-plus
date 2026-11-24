// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { OutgoingApprovalDecision, OutgoingApprovalToast } from './OutgoingApprovalCard'
import { STEADY_SETTLE_MS } from './use-steady-click'

vi.mock('../hq/use-hq-spaces', () => ({
  useHqSpaces: () => ({ spaces: [], stripeOf: () => null }),
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
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  decide.mockClear()
  tops.clear()
})

/** Renders the card; `settled`: it has been on screen for the settle time, as one he has read. */
function setup(settled = true): { approve: HTMLElement; move: HTMLElement } {
  render(<OutgoingApprovalDecision item={item} />)
  const approve = screen.getByRole('button', { name: 'Approve' })
  const move = screen.getByRole('button', { name: /Ask in TASK-1 instead/ })
  tops.set(approve, 300)
  tops.set(move, 360)
  if (settled) {
    now += STEADY_SETTLE_MS
  }
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

// Review 24.11: the jump was seen only by a move that landed on a button.
it('holds a click after the card jumped while the pointer crossed its text', () => {
  const { move } = setup()
  const text = screen.getByText('Hello Ann')
  fireEvent.pointerMove(text)
  now += 50
  tops.set(screen.getByRole('button', { name: 'Approve' }), 240)
  tops.set(move, 300)
  fireEvent.pointerMove(text)
  now += 100
  fireEvent.pointerMove(move)
  now += 100
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()
})

// Review 24.11: a jump right as a resting pointer set off was let through once 1.5 s had passed.
it('holds a click after the card jumped while the pointer rested on its text', () => {
  const { approve, move } = setup()
  const text = screen.getByText('Hello Ann')
  fireEvent.pointerMove(text)
  now += 5000
  tops.set(approve, 240)
  tops.set(move, 300)
  fireEvent.pointerMove(text)
  now += 100
  fireEvent.pointerMove(move)
  now += 100
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()
})

// Review 24.11: «Click again» was not taken until the mouse moved, and then only after the settle time.
it('takes «Click again» on the button the pointer went for, without a move, once the note was up', () => {
  const { approve } = setup()
  fireEvent.pointerMove(approve)
  tops.set(approve, 290)
  now += 300
  mouseClick(approve)
  expect(screen.getByRole('status')).toHaveTextContent('click again')
  now += 100
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()

  now += STEADY_SETTLE_MS
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(decide.mock.calls[0]?.[1]).toBe('approved')
})

it('holds «Click again» if the button moved once more after the held click', () => {
  const { approve } = setup()
  fireEvent.pointerMove(approve)
  tops.set(approve, 290)
  now += 300
  mouseClick(approve)
  tops.set(approve, 200)
  now += STEADY_SETTLE_MS
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()
})

// Second review 24.11: «Click again» on the button that slid in sent the message the wrong way.
it('holds «Click again» on a button that slid under the pointer, and takes a move to Approve at once', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(approve)
  tops.set(approve, 240)
  tops.set(move, 300)
  now += 300
  mouseClick(move)
  now += STEADY_SETTLE_MS
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()

  now += 100
  fireEvent.pointerMove(approve)
  now += 100
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(decide.mock.calls[0]?.[1]).toBe('approved')
  expect(decide.mock.calls[0]?.[3]).not.toHaveProperty('moveTo')
})

it('holds a jitter back onto the slid-in button right after the hold, and takes it once read', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(approve)
  tops.set(approve, 240)
  tops.set(move, 300)
  now += 300
  mouseClick(move)
  now += 100
  fireEvent.pointerMove(move)
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()

  now += STEADY_SETTLE_MS
  fireEvent.pointerMove(move)
  mouseClick(move)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(decide.mock.calls[0]?.[3]).toMatchObject({ moveTo: 'clickup' })
})

it('takes a click on a card that appeared under a resting pointer once the pointer moved onto it', () => {
  const { approve } = setup()
  mouseClick(approve)
  now += STEADY_SETTLE_MS
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()
  // Each click without a move restarts the wait, as on a button that slid in.
  now += STEADY_SETTLE_MS
  fireEvent.pointerMove(approve)
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
})

// Third review 24.11: a jitter onto the slid-in button made it «the one he went for».
it('holds «Click again» after a jitter onto the button that slid under the pointer', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(approve)
  tops.set(approve, 240)
  tops.set(move, 300)
  now += 50
  fireEvent.pointerMove(move)
  now += 100
  mouseClick(move)
  now += STEADY_SETTLE_MS
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()

  fireEvent.pointerMove(approve)
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(decide.mock.calls[0]?.[3]).not.toHaveProperty('moveTo')
})

// Third review 24.11: the Inbox centring a new Approve while the pointer was away held the first
// click after he came for it.
it('takes a click on a card the feed scrolled while the pointer was away', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(document.body)
  now += 5000
  tops.set(approve, 240)
  tops.set(move, 300)
  fireEvent.scroll(document)
  now += 2000
  fireEvent.pointerMove(document.body)
  now += 100
  fireEvent.pointerMove(approve)
  now += 200
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
})

it('takes a click on a card that moved while the pointer idled away from it', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(document.body)
  now += 5000
  tops.set(approve, 240)
  tops.set(move, 300)
  fireEvent.pointerMove(document.body)
  now += 100
  fireEvent.pointerMove(approve)
  now += 200
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
})

it('holds a click on a button reached right after a scroll he did not make', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(screen.getByText('Hello Ann'))
  tops.set(approve, 240)
  tops.set(move, 300)
  fireEvent.scroll(document)
  now += 100
  fireEvent.pointerMove(move)
  now += 100
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()
})

// A page-down while the pointer rests on the card is a scroll he did not make with the wheel; he
// reads the card where it came to, so a move to Approve well after it is aimed.
it('takes a click well after a scroll that moved the card under a resting pointer', () => {
  const { approve, move } = setup()
  const text = screen.getByText('Hello Ann')
  fireEvent.pointerMove(text)
  tops.set(approve, 240)
  tops.set(move, 300)
  fireEvent.scroll(document)
  now += 2000
  fireEvent.pointerMove(text)
  now += 100
  fireEvent.pointerMove(approve)
  now += 200
  mouseClick(approve)
  expect(decide).toHaveBeenCalledTimes(1)
})

it('holds a click right after the card appeared, even after a move onto the button', () => {
  const { approve } = setup(false)
  fireEvent.pointerMove(approve)
  now += 100
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()
})

// Second review 24.11: any scroll in the window right after a wheel counted as the owner's own.
it('does not take what another scroller moved right after a wheel as seen', () => {
  const { approve, move } = setup()
  fireEvent.pointerMove(approve, { clientX: 10, clientY: 310 })
  tops.set(approve, 240)
  tops.set(move, 300)
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(move)
  const other = document.createElement('div')
  document.body.append(other)
  fireEvent.wheel(document)
  fireEvent.scroll(other)
  now += 300
  mouseClick(move)
  expect(decide).not.toHaveBeenCalled()
  other.remove()
})

// Second review 24.11: a second hold late in the first one's 4 s showed its note for a moment.
it('keeps the note up for its full time after a second hold', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { approve } = setup()
  mouseClick(approve)
  act(() => vi.advanceTimersByTime(3900))
  mouseClick(approve)
  act(() => vi.advanceTimersByTime(200))
  expect(screen.getByRole('status')).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(4000))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

const isBefore = (a: Element, b: Element): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

it('puts the held note under the buttons in the feed and the bell', () => {
  const { approve, move } = setup()
  mouseClick(approve)
  const note = screen.getByRole('status')
  expect(isBefore(approve, note)).toBe(true)
  expect(isBefore(move, note)).toBe(true)
})

// Review 24.11: a toast is pinned at its bottom, so a note under the buttons lifted them by a line.
it('puts the held note above the buttons in a toast', () => {
  render(<OutgoingApprovalToast item={item} />)
  const approve = screen.getByRole('button', { name: 'Approve' })
  mouseClick(approve)
  expect(decide).not.toHaveBeenCalled()
  expect(isBefore(screen.getByRole('status'), approve)).toBe(true)
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
