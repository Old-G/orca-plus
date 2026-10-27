// Custom build (outgoing-footer): what a held call's card offers beside Approve, asked of main once
// per card.
import { useEffect, useState } from 'react'
import {
  NO_OUTGOING_APPROVAL_OPTIONS,
  type OutgoingApprovalOptions
} from '../../../../../shared/outgoing-approval/outgoing-approval-options'

// Custom build (hq-approve-steady): a card shown again (the toast, the bell, HQ+) starts with what it
// already loaded, so it does not grow under the pointer a second time.
const known = new Map<string, OutgoingApprovalOptions>()
const KNOWN_MAX = 50

export function useOutgoingApprovalOptions(draftId: string | null): OutgoingApprovalOptions {
  const [options, setOptions] = useState<OutgoingApprovalOptions>(
    () => (draftId ? known.get(draftId) : undefined) ?? NO_OUTGOING_APPROVAL_OPTIONS
  )
  useEffect(() => {
    if (!draftId) {
      return
    }
    let live = true
    window.api.outgoingApproval
      .options(draftId)
      .then((next) => {
        known.set(draftId, next)
        if (known.size > KNOWN_MAX) {
          known.delete(known.keys().next().value ?? draftId)
        }
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
