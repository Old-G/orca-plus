// Custom build (google-disconnect-forget): what this host kept from a Google account goes when the
// account is disconnected here, not when it next ages out — the trigger checks' cursors and listeners,
// the Drive text kept for paging, and whatever a part of Orca registered (automation run history, the
// trigger checker's memory). The sign-in file itself is removed by the credential store.
import { forgetCachedFileText } from './google-drive-text-cache'
import {
  googleTriggerStatePath,
  readGoogleTriggerState,
  writeGoogleTriggerState,
  type GoogleTriggerState
} from './google-trigger-state'

type GoogleAccountRemovedListener = (email: string) => void | Promise<void>

const removedListeners = new Set<GoogleAccountRemovedListener>()

/** Called with the address after an account is disconnected on this host; returns the unsubscribe. */
export function onGoogleAccountRemoved(listener: GoogleAccountRemovedListener): () => void {
  removedListeners.add(listener)
  return () => {
    removedListeners.delete(listener)
  }
}

/** The trigger state without this account's cursors and its bots' listening start times. */
export function forgetGoogleTriggerAccount(
  state: GoogleTriggerState,
  email: string
): GoogleTriggerState {
  const account = email.toLowerCase()
  return {
    accounts: Object.fromEntries(
      Object.entries(state.accounts).filter(([key]) => key.toLowerCase() !== account)
    ),
    // Keys are `${botId} ${account}`; an address has no space, so the last word is the account.
    listeners: Object.fromEntries(
      Object.entries(state.listeners).filter(([key]) => !key.toLowerCase().endsWith(` ${account}`))
    )
  }
}

/** Forgets the account everywhere. Each part is tried on its own: one that fails is logged, never thrown. */
export async function forgetGoogleAccount(
  email: string,
  statePath: string = googleTriggerStatePath()
): Promise<void> {
  forgetCachedFileText(email)
  try {
    const state = readGoogleTriggerState(statePath)
    const kept = forgetGoogleTriggerAccount(state, email)
    if (JSON.stringify(kept) !== JSON.stringify(state)) {
      writeGoogleTriggerState(kept, statePath)
    }
  } catch (error) {
    console.warn('[google] could not forget the trigger state of a disconnected account', error)
  }
  for (const listener of removedListeners) {
    try {
      await listener(email)
    } catch (error) {
      console.warn('[google] could not forget a disconnected account', error)
    }
  }
}
