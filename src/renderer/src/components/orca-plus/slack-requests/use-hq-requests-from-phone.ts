// Custom build (hq-mobile): what the paired phone presses runs here, the same as the bell's buttons —
// Do / Just reply on a request, or a bell item's button — because that code lives in this window.
import { useEffect } from 'react'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../../../../shared/outgoing-approval/outgoing-approval-bell'
import { HQ_SLACK_REQUEST_ACTION } from '../../../../../shared/hq-slack-request-bell'
import { runPulseBellAction } from '../pulse-bell/pulse-bell-actions'
import { runHqSlackRequestAction } from './hq-slack-request-actions'

const warn = (error: unknown): void =>
  console.warn('[hq-mobile] request from the phone failed:', error)

async function runBellAction(itemId: string, actionId: string): Promise<void> {
  const item = (await window.api.pulseBell.list()).find((entry) => entry.id === itemId)
  // Why: approvals stay on the Mac; the Mac's RPC refuses them too, this is the second lock.
  if (!item || item.kind === OUTGOING_APPROVAL_BELL_KIND) {
    return
  }
  if (item.actions.some((action) => action.id === actionId)) {
    await runPulseBellAction(item, actionId)
  }
}

export function useHqRequestsFromPhone(): void {
  useEffect(() => {
    const offRequest = window.api.hqProjects.onRunRequest?.(({ id, action }) => {
      const actionId = action === 'do' ? HQ_SLACK_REQUEST_ACTION.do : HQ_SLACK_REQUEST_ACTION.answer
      void runHqSlackRequestAction(id, actionId).catch(warn)
    })
    const offBell = window.api.hqProjects.onRunBellAction?.(({ itemId, actionId }) => {
      void runBellAction(itemId, actionId).catch(warn)
    })
    return () => {
      offRequest?.()
      offBell?.()
    }
  }, [])
}
