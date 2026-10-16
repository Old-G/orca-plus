// Custom build (hq-mobile): Do / Just reply pressed on the paired phone runs here, the same as the
// bell's buttons, because creating the task and starting Claude live in this window.
import { useEffect } from 'react'
import { HQ_SLACK_REQUEST_ACTION } from '../../../../../shared/hq-slack-request-bell'
import { runHqSlackRequestAction } from './hq-slack-request-actions'

export function useHqRequestsFromPhone(): void {
  useEffect(
    () =>
      window.api.hqProjects.onRunRequest?.(({ id, action }) => {
        const actionId =
          action === 'do' ? HQ_SLACK_REQUEST_ACTION.do : HQ_SLACK_REQUEST_ACTION.answer
        void runHqSlackRequestAction(id, actionId).catch((error: unknown) =>
          console.warn('[hq-mobile] request from the phone failed:', error)
        )
      }),
    []
  )
}
