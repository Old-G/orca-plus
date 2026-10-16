// Custom build (hq-mobile): the phone's Do / Just reply on a request runs where the button's code
// lives — in the Orca+ window — exactly as the bell runs it.
import type { HqRequestDesktopAction } from '../../shared/rpc-contract/hq-projects-params'

type Sender = (request: { id: string; action: HqRequestDesktopAction }) => boolean

let sender: Sender | null = null

/** Set once the window side is wired; returns false when no window can take the request. */
export function setHqRequestDesktopSender(next: Sender | null): void {
  sender = next
}

export function runHqRequestOnDesktop(
  id: string,
  action: HqRequestDesktopAction
): { ok: true } | { ok: false; error: string } {
  return sender?.({ id, action })
    ? { ok: true }
    : { ok: false, error: 'Orca+ has no open window on the Mac to run this in.' }
}
