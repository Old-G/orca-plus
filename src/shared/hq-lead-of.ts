// Custom build (hq-lead-of, A1 28.11): `orca hq lead` — the Lead of a plan, as its `Lead chat:` line
// names it, followed to the chat that continues it after a handoff.

/** The address `orca chat send` takes for «the Lead of my plan». */
export const HQ_SEND_TO_LEAD = 'lead'

export type HqLeadResult = {
  /** The plan file in HQ/runs whose `Lead chat:` line names the Lead. */
  plan: string
  /** The Lead's thread address; null when it has none yet. */
  address: string | null
  sessionId: string
  /** Its tab is open; null when Orca+ could not read the open tabs. */
  open: boolean | null
  /** The chat the plan line names, when a handoff moved the Lead on to `sessionId`. */
  handedOffFrom?: string
}
