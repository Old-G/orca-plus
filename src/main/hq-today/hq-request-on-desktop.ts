// Custom build (hq-mobile): what the paired phone presses — Do / Just reply on a request, a bell
// item's button — runs where that button's code lives, in the Orca+ window, exactly as it runs there.
import type { HqRequestDesktopAction } from '../../shared/rpc-contract/hq-projects-params'

/** Hands a payload to one window on a channel; false when no window can take it. */
type Sender = (channel: string, payload: unknown) => boolean

let sender: Sender | null = null

export function setHqDesktopSender(next: Sender | null): void {
  sender = next
}

type Run = { ok: true } | { ok: false; error: string }

const NO_WINDOW: Run = { ok: false, error: 'Orca+ has no open window on the Mac to run this in.' }

export function runHqRequestOnDesktop(id: string, action: HqRequestDesktopAction): Run {
  return sender?.('hqProjects:runRequest', { id, action }) ? { ok: true } : NO_WINDOW
}

/** Custom build (hq-reports): the owner's decisions on a report, for an HQ chat in the window. */
export function runHqReportDecisionsOnDesktop(path: string, text: string): Run {
  return sender?.('hqProjects:runReportDecisions', { path, text }) ? { ok: true } : NO_WINDOW
}

export function runHqBellActionOnDesktop(itemId: string, actionId: string): Run {
  return sender?.('hqProjects:runBellAction', { itemId, actionId }) ? { ok: true } : NO_WINDOW
}
