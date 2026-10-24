// Custom build (hq-plus-links): a link in HQ+ asks where to open, as a link in a chat or the terminal
// does — Orca's browser (HQ+'s Browser tab) or the system one; ⌘-click opens the first choice outright,
// ⇧⌘-click the other.
import type { LinkActionRequest } from '@/components/link-actions/link-action-request'
import { isTerminalLinkDirectActivation } from '@/components/terminal-pane/terminal-link-activation'
import {
  buildHttpLinkActions,
  httpLinkActionDestinationsFor,
  type HttpLinkDestination
} from '@/lib/http-link-destinations'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { nativeChatPlainLinkClickBehavior } from '../../native-chat/native-chat-link-click-behavior'

export type HqPlusLinkClick = Pick<
  React.MouseEvent<HTMLElement>,
  'clientX' | 'clientY' | 'detail' | 'currentTarget' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
> & { button?: number }

export type HqPlusLinkDeps = {
  settings:
    | Pick<
        GlobalSettings,
        'openLinksInApp' | 'terminalLinkClickBehavior' | 'terminalLinkActionPopoverEnabled'
      >
    | null
    | undefined
  /** False where HQ+ has no browser of its own to show a page in (the web client). */
  canOpenInOrca: boolean
  open: (url: string, destination: HttpLinkDestination) => void
  request: (request: LinkActionRequest) => void
}

export function hqPlusLinkClick(
  url: string,
  event: HqPlusLinkClick | undefined,
  deps: HqPlusLinkDeps
): void {
  const destinations = deps.canOpenInOrca
    ? httpLinkActionDestinationsFor(deps.settings, { kind: 'local' }, true)
    : { primary: 'system' as const }
  const open = (destination: HttpLinkDestination | undefined): void =>
    deps.open(url, destination ?? destinations.primary)
  if (!event) {
    open(destinations.primary)
    return
  }
  if (isTerminalLinkDirectActivation(event)) {
    open(event.shiftKey ? destinations.alternate : destinations.primary)
    return
  }
  // Why: a button must do something, so only the popover setting matters here, not «none».
  if (nativeChatPlainLinkClickBehavior(deps.settings) !== 'actions') {
    open(destinations.primary)
    return
  }
  const target = event.currentTarget
  const keyboard = event.detail === 0 ? target.getBoundingClientRect() : null
  deps.request({
    anchorX: keyboard?.left ?? event.clientX,
    anchorY: keyboard?.bottom ?? event.clientY,
    destination: url,
    kind: 'url',
    restoreFocus: () => {
      if (target.isConnected) {
        target.focus({ preventScroll: true })
      }
    },
    ...buildHttpLinkActions(destinations, open)
  })
}
