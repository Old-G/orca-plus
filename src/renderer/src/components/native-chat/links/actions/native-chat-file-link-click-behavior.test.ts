import { describe, expect, it } from 'vitest'
import { nativeChatPlainFileLinkClickBehavior } from './native-chat-link-click-behavior'

// Custom build (chat-file-links): the hook suite upstream removed (#38448) covered this; kept as a unit.
describe('nativeChatPlainFileLinkClickBehavior', () => {
  it('opens the file on a plain click by default and when the terminal setting asks for the actions popover', () => {
    expect(nativeChatPlainFileLinkClickBehavior(undefined)).toBe('open')
    expect(
      nativeChatPlainFileLinkClickBehavior({
        terminalLinkClickBehavior: 'actions',
        terminalLinkActionPopoverEnabled: true
      })
    ).toBe('open')
  })

  it('stays inert only when link clicks are set to none', () => {
    expect(
      nativeChatPlainFileLinkClickBehavior({
        terminalLinkClickBehavior: 'none',
        terminalLinkActionPopoverEnabled: false
      })
    ).toBe('none')
  })
})
