// Custom build (outgoing-approval): the owner's answer to a held outgoing call. Renderer-only on purpose:
// agents reach the hook server and RPC, never this.
import type { PulseApprovalOutcome } from '../../shared/pulse-types'
import type {
  OutgoingApprovalChoice,
  OutgoingApprovalOptions
} from '../../shared/outgoing-approval/outgoing-approval-options'

export type OutgoingApprovalApi = {
  decide: (
    draftId: string,
    outcome: PulseApprovalOutcome,
    editedText?: string,
    choice?: OutgoingApprovalChoice
  ) => Promise<void>
  /** Custom build (outgoing-footer): the footer and other choices the card offers. */
  options: (draftId: string) => Promise<OutgoingApprovalOptions>
  /** Custom build (hq-plus-side-blocks): settles a draft an agent added by hand (no held call). */
  settleAgentDraft: (draftId: string, outcome: 'approved' | 'rejected') => Promise<void>
}
