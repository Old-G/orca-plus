// Custom build (pulse-bell): the handoff offers to everyone who mirrors them — the bell, the sweep and
// the windows' toast. Custom build (hq-handoff-once, owner 27.11): with «New chat after a handoff» on,
// the owner sees only the offers Orca+ could not start; the sweep still gets every one.
import { BrowserWindow } from 'electron'
import { claudeHandoffOffersShown, type ClaudeHandoffOffer } from '../../shared/claude-handoff-file'

type OffersListener = (offers: ClaudeHandoffOffer[]) => void
const offersListeners = new Set<OffersListener>()

/** «New chat after a handoff», read from settings once the handlers are registered. */
let autoStartOn: () => boolean = () => false

export function setClaudeHandoffAutoStart(read: () => boolean): void {
  autoStartOn = read
}

/** Lets the bell and the sweep mirror the offers. */
export function onClaudeHandoffOffersChanged(listener: OffersListener): () => void {
  offersListeners.add(listener)
  return () => offersListeners.delete(listener)
}

/** What the owner's windows and the bell show: with auto-start on, only offers it did not start. */
export function claudeHandoffOffersForOwner(
  offers: readonly ClaudeHandoffOffer[]
): ClaudeHandoffOffer[] {
  return claudeHandoffOffersShown(offers, autoStartOn())
}

export function broadcastClaudeHandoffOffers(offers: ClaudeHandoffOffer[]): void {
  // Why: the listeners (the sweep among them) need every offer; the bell filters for itself.
  for (const listener of offersListeners) {
    try {
      listener(offers)
    } catch (error) {
      console.warn('[claude-handoff] offers listener failed:', error)
    }
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('claudeHandoff:offersChanged', claudeHandoffOffersForOwner(offers))
    }
  }
}
