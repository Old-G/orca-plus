// Custom build (pulse-bell): an agent that finishes while Orca+ is in front pops a toast naming it,
// with Open — the desktop banner only shows while Orca+ is in the background. A chat stopped on its
// Claude limit pops one too, with the item's own buttons (continue on another subscription).
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  PULSE_BELL_ACTION,
  PULSE_BELL_KIND,
  readPulseBellPaneRef
} from '../../../../../shared/pulse-bell'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { runPulseBellAction } from './pulse-bell-actions'
import { usePulseBellInbox } from './use-pulse-bell-inbox'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

const TOASTED_KINDS: ReadonlySet<string> = new Set([
  PULSE_BELL_KIND.agentFinished,
  PULSE_BELL_KIND.claudeChatLimit
])

const toastId = (item: PulseInboxItem): string => `pulse-bell-toast-${item.id}`

/** The user is already looking at the pane that finished, so a toast would only cover it. */
function isWatching(item: PulseInboxItem): boolean {
  const ref = readPulseBellPaneRef(item.refId)
  if (!ref?.worktreeId || !ref.tabId || !document.hasFocus()) {
    return false
  }
  const state = useAppStore.getState()
  if (state.activeWorktreeId !== ref.worktreeId) {
    return false
  }
  const groupId = state.activeGroupIdByWorktree[ref.worktreeId]
  const group = state.groupsByWorktree[ref.worktreeId]?.find((entry) => entry.id === groupId)
  return state.activeTabId === ref.tabId || group?.activeTabId === ref.tabId
}

function act(item: PulseInboxItem, actionId: string): void {
  void runPulseBellAction(item, actionId).catch((error: unknown) =>
    console.warn('[pulse-bell] toast action failed:', error)
  )
}

export function usePulseBellToasts(): void {
  const items = usePulseBellInbox()
  // Why: null until the first list lands — items already open at launch stay in the Inbox only.
  const known = useRef<Set<string> | null>(null)
  const shown = useRef(new Set<string>())

  useEffect(() => {
    const finished = items.filter((item) => TOASTED_KINDS.has(item.kind))
    const open = new Set(finished.map((item) => item.id))
    for (const id of shown.current) {
      if (!open.has(id)) {
        toast.dismiss(`pulse-bell-toast-${id}`)
        shown.current.delete(id)
      }
    }
    if (known.current === null) {
      known.current = open
      return
    }
    for (const item of finished) {
      if (known.current.has(item.id)) {
        continue
      }
      known.current.add(item.id)
      // Why: a limit stop needs a choice the chat itself does not offer, so it toasts even in view.
      if (item.kind === PULSE_BELL_KIND.agentFinished && isWatching(item)) {
        continue
      }
      shown.current.add(item.id)
      const primary =
        item.kind === PULSE_BELL_KIND.agentFinished
          ? { id: PULSE_BELL_ACTION.open, label: translate('auto.pulseBell.action.open', 'Open') }
          : item.actions.find((action) => action.id !== PULSE_BELL_ACTION.dismiss)
      toast.info(translate(`auto.pulseBell.kind.${item.kind}.${item.urgency}`, item.title), {
        id: toastId(item),
        description: item.body ?? undefined,
        duration: Number.POSITIVE_INFINITY,
        ...(primary
          ? { action: { label: primary.label, onClick: () => act(item, primary.id) } }
          : {}),
        cancel: {
          label: translate('auto.pulseBell.action.dismiss', 'Not now'),
          onClick: () => act(item, PULSE_BELL_ACTION.dismiss)
        }
      })
    }
  }, [items])
}
