const EXPLORER_SHELL_SELECTOR = '[data-orca-explorer-shell]'
// The editor re-mounts a retargeted/closed tab and focuses it ~150ms after a move lands.
export const FILE_EXPLORER_FOCUS_SETTLE_MS = 300

/**
 * Runs an explorer file operation without letting it take keyboard focus out of the explorer.
 *
 * Why: moving or trashing a file that is open in the editor retargets/closes its tab, and the
 * editor then focuses itself. Cmd+Z right after a paste would reach Monaco instead of the
 * explorer's undo. Focus is handed back unless the user moved it themselves (pointer/key input
 * outside the explorer while the operation ran).
 */
export async function keepFileExplorerFocus<T>(run: () => Promise<T>): Promise<T> {
  if (typeof document === 'undefined') {
    return run()
  }
  const before = document.activeElement
  const shell =
    before instanceof HTMLElement ? before.closest<HTMLElement>(EXPLORER_SHELL_SELECTOR) : null
  if (!shell || !(before instanceof HTMLElement)) {
    return run()
  }
  let userMovedFocus = false
  const isOutside = (target: EventTarget | null): boolean =>
    target instanceof Node && !shell.contains(target)
  const onUserInput = (event: Event): void => {
    if (isOutside(event.target)) {
      userMovedFocus = true
    }
  }
  const onFocusIn = (event: FocusEvent): void => {
    if (userMovedFocus || !isOutside(event.target)) {
      return
    }
    const target = before.isConnected
      ? before
      : (shell.querySelector<HTMLElement>('[data-selected="true"]') ??
        shell.querySelector<HTMLElement>('[data-index] button'))
    target?.focus({ preventScroll: true })
  }
  document.addEventListener('pointerdown', onUserInput, true)
  document.addEventListener('keydown', onUserInput, true)
  document.addEventListener('focusin', onFocusIn, true)
  try {
    return await run()
  } finally {
    await new Promise((resolve) => setTimeout(resolve, FILE_EXPLORER_FOCUS_SETTLE_MS))
    document.removeEventListener('pointerdown', onUserInput, true)
    document.removeEventListener('keydown', onUserInput, true)
    document.removeEventListener('focusin', onFocusIn, true)
  }
}
