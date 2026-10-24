// Custom build (hq-mobile): what the paired phone presses runs here, the same as the bell's buttons —
// Do / Just reply on a request, a bell item's button, decisions on a report — because that code lives
// in this window. So does bringing back a closed chat that `orca chat send` is writing to.
import { useEffect } from 'react'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../../../../shared/outgoing-approval/outgoing-approval-bell'
import { HQ_SLACK_REQUEST_ACTION } from '../../../../../shared/hq-slack-request-bell'
import { runPulseBellAction } from '../pulse-bell/pulse-bell-actions'
import { runHqSlackRequestAction } from './hq-slack-request-actions'
import { HQ_REPORT_FOLDERS } from '../../../../../shared/hq-reports'
import { useAppStore } from '@/store'
import { askHq, startHqReportDecisions } from '../hq/hq-ask-chat'
import { findHqWorktreeId } from '../hq/hq-today-actions'
import { openHqRouteChat } from '../pulse-bell/hq-route-send'
import { hqFlavor } from '../hq-plus/hq-plus-flavor'

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

/** Custom build (hq-reports): decisions sent from the phone's Reports page start their HQ chat here. */
async function runReportDecisions(path: string, text: string): Promise<void> {
  const folder = HQ_REPORT_FOLDERS.find((entry) => path.startsWith(`${entry}/`))
  const state = useAppStore.getState()
  const worktreeId = findHqWorktreeId(state.settings?.hqPath, state.repos, state.worktreesByRepo)
  if (!folder || !worktreeId) {
    return
  }
  const result = await startHqReportDecisions(worktreeId, { path, folder }, text)
  if (!result.ok) {
    warn(result.message)
  }
}

/** Custom build (hq-plus-phone): «Write to HQ» on the phone asks the Ask HQ chat here. */
async function askHqFromPhone(text: string): Promise<void> {
  const state = useAppStore.getState()
  const worktreeId = findHqWorktreeId(state.settings?.hqPath, state.repos, state.worktreesByRepo)
  if (!worktreeId) {
    return
  }
  const result = await askHq(worktreeId, text)
  if (!result.ok) {
    warn(result.message)
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
    const offReport = window.api.hqProjects.onRunReportDecisions?.(({ path, text }) => {
      void runReportDecisions(path, text).catch(warn)
    })
    const offAsk = window.api.hqProjects.onAskHq?.(({ text }) => {
      void askHqFromPhone(text).catch(warn)
    })
    // Custom build (hq-plus-reports)
    const offReopen = window.api.hqProjects.onReopenChat?.((chat) => {
      // Why: only HQ+ brings back a chat another chat wrote to; the classic HQ leaves it closed.
      if (hqFlavor() === 'plus') {
        void openHqRouteChat(chat).catch(warn)
      }
    })
    return () => {
      offRequest?.()
      offBell?.()
      offReport?.()
      offAsk?.()
      offReopen?.()
    }
  }, [])
}
