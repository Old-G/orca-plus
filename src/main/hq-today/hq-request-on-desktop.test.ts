import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runHqBellActionOnDesktop,
  runHqRequestOnDesktop,
  setHqDesktopSender
} from './hq-request-on-desktop'

afterEach(() => setHqDesktopSender(null))

describe('a phone request run on the Mac', () => {
  it('hands Do to the window, and says so when no window can take it', () => {
    expect(runHqRequestOnDesktop('C1:1', 'do')).toEqual({
      ok: false,
      error: 'Orca+ has no open window on the Mac to run this in.'
    })
    const send = vi.fn(() => true)
    setHqDesktopSender(send)
    expect(runHqRequestOnDesktop('C1:1', 'do')).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith('hqProjects:runRequest', { id: 'C1:1', action: 'do' })
    expect(runHqBellActionOnDesktop('i1', 'open')).toEqual({ ok: true })
    expect(send).toHaveBeenLastCalledWith('hqProjects:runBellAction', {
      itemId: 'i1',
      actionId: 'open'
    })
    setHqDesktopSender(() => false)
    expect(runHqRequestOnDesktop('C1:1', 'answer').ok).toBe(false)
  })
})
