// Custom build (outgoing-approval): the owner's answer to a held outgoing call. Renderer-only on purpose:
// agents reach the hook server and RPC, never this.
import type { PulseApprovalOutcome } from '../../shared/pulse-types'

export type OutgoingApprovalApi = {
  decide: (draftId: string, outcome: PulseApprovalOutcome, editedText?: string) => Promise<void>
}
