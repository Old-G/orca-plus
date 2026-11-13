// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqChatItem } from '../hq/hq-chat-list'

vi.mock('../hq/HqChatAvatar', () => ({ useHqChatTitle: () => 'Fix the template' }))
vi.mock('./use-hq-plus-chat-chip', () => ({
  useHqPlusChatChip: () => ({ chip: null, waitingFor: null, live: false })
}))
vi.mock('./HqPlusCloseChat', () => ({ HqPlusCloseChat: () => null }))

import { HqPlusChatRow } from './HqPlusChatRow'

const item = {
  key: 'chat-1',
  kind: 'chat',
  group: 'quiet',
  projectName: 'acme',
  repoId: 'r1',
  sortAt: 0,
  card: null
} as unknown as HqChatItem

const scroll = vi.fn()
beforeEach(() => {
  scroll.mockClear()
  Element.prototype.scrollIntoView = scroll
})
afterEach(cleanup)

function row(picked: boolean, onPick = vi.fn()): React.JSX.Element {
  return (
    <HqPlusChatRow
      item={item}
      picked={picked}
      now={0}
      tile={{ letters: 'AC', color: null }}
      closer={null}
      onPick={onPick}
    />
  )
}

describe('HqPlusChatRow follows the chat open on the right (13.11)', () => {
  it('scrolls to and glows once when the chat is opened from elsewhere', () => {
    const { rerender } = render(row(false))
    rerender(row(true))
    const button = screen.getByRole('button', { current: true })
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    expect(button.dataset.flash).toBe('true')
  })

  it('only marks the row the owner clicked', () => {
    const onPick = vi.fn()
    const { rerender } = render(row(false, onPick))
    fireEvent.click(screen.getByRole('button'))
    rerender(row(true, onPick))
    expect(onPick).toHaveBeenCalledOnce()
    expect(scroll).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { current: true }).dataset.flash).toBeUndefined()
  })

  it('a row drawn already picked comes into view without the glow', () => {
    render(row(true))
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(screen.getByRole('button', { current: true }).dataset.flash).toBeUndefined()
  })
})
