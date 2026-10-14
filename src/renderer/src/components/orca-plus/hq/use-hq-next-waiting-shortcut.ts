// Custom build (hq-chats): ⌘⌥↓ (Ctrl+Alt+↓ elsewhere) in HQ's messenger view opens the next chat that
// waits for the user — a free combo beside the ⌘⌥←/→ history keys.
import { useEffect } from 'react'
import { getShortcutPlatform } from '@/lib/shortcut-platform'

export function useHqNextWaitingShortcut(onNext: () => void): string[] {
  const isMac = getShortcutPlatform() === 'darwin'
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (mod && event.altKey && !event.shiftKey && event.key === 'ArrowDown') {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMac, onNext])
  return isMac ? ['⌘', '⌥', '↓'] : ['Ctrl', 'Alt', '↓']
}
