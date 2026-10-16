import { afterEach, describe, expect, it, vi } from 'vitest'
import { runHqRequestOnDesktop, setHqRequestDesktopSender } from './hq-request-on-desktop'

afterEach(() => setHqRequestDesktopSender(null))

describe('a phone request run on the Mac', () => {
  it('hands Do to the window, and says so when no window can take it', () => {
    expect(runHqRequestOnDesktop('C1:1', 'do')).toEqual({
      ok: false,
      error: 'Orca+ has no open window on the Mac to run this in.'
    })
    const send = vi.fn(() => true)
    setHqRequestDesktopSender(send)
    expect(runHqRequestOnDesktop('C1:1', 'do')).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith({ id: 'C1:1', action: 'do' })
    setHqRequestDesktopSender(() => false)
    expect(runHqRequestOnDesktop('C1:1', 'answer').ok).toBe(false)
  })
})
