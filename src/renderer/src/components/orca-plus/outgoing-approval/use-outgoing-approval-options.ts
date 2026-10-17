// Custom build (outgoing-footer): what a held call's card offers beside Approve, asked of main once
// per card.
import { useEffect, useState } from 'react'
import type { OutgoingApprovalOptions } from '../../../../../shared/outgoing-approval/outgoing-approval-options'

const NONE: OutgoingApprovalOptions = { footer: null }

export function useOutgoingApprovalOptions(draftId: string | null): OutgoingApprovalOptions {
  const [options, setOptions] = useState<OutgoingApprovalOptions>(NONE)
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
