// Custom build (outgoing-footer): what a held call's card offers beside Approve, asked of main once
// per card.
import { useEffect, useState } from 'react'
import {
  NO_OUTGOING_APPROVAL_OPTIONS,
  type OutgoingApprovalOptions
} from '../../../../../shared/outgoing-approval/outgoing-approval-options'

export function useOutgoingApprovalOptions(draftId: string | null): OutgoingApprovalOptions {
  const [options, setOptions] = useState<OutgoingApprovalOptions>(NO_OUTGOING_APPROVAL_OPTIONS)
  useEffect(() => {
    if (!draftId) {
      return
    }
    let live = true
    window.api.outgoingApproval
      .options(draftId)
      .then((next) => {
        if (live) {
          setOptions(next)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [draftId])
  return options
}
