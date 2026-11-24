// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from 'vitest'
import { hqPlusMoveWhenPointerAway, hqPlusPointerOver } from './hq-plus-pointer-hold'

function scroller(hovered: boolean): HTMLDivElement {
  const element = document.createElement('div')
  vi.spyOn(element, 'matches').mockImplementation((selector) =>
    selector === ':hover' ? hovered : false
  )
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('scrolls at once while the pointer is elsewhere', () => {
  const move = vi.fn()
  hqPlusMoveWhenPointerAway(scroller(false), move)
  expect(move).toHaveBeenCalledTimes(1)
})

it('waits while the pointer is over the feed and scrolls once it leaves', () => {
  const element = scroller(true)
  const move = vi.fn()
  hqPlusMoveWhenPointerAway(element, move)
  expect(move).not.toHaveBeenCalled()
  element.dispatchEvent(new Event('pointerleave'))
  element.dispatchEvent(new Event('pointerleave'))
  expect(move).toHaveBeenCalledTimes(1)
})

it('drops a waiting scroll that was cancelled', () => {
  const element = scroller(true)
  const move = vi.fn()
  const cancel = hqPlusMoveWhenPointerAway(element, move)
  cancel()
  element.dispatchEvent(new Event('pointerleave'))
  expect(move).not.toHaveBeenCalled()
})

it('reads no hover where the selector is not supported', () => {
  const element = document.createElement('div')
  vi.spyOn(element, 'matches').mockImplementation(() => {
    throw new Error('unsupported')
  })
  expect(hqPlusPointerOver(element)).toBe(false)
})
