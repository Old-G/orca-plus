// Custom build (outgoing-footer): what an approval card offers beside Approve, and what the owner chose.

export type OutgoingApprovalOptions = {
  /** The line Approve adds to the message; null for a call that takes none. */
  footer: string | null
}

export type OutgoingApprovalChoice = {
  /** False sends the message without its footer. */
  footer?: boolean
}

export function readOutgoingApprovalChoice(value: unknown): OutgoingApprovalChoice {
  const footer = value && typeof value === 'object' ? Reflect.get(value, 'footer') : undefined
  return typeof footer === 'boolean' ? { footer } : {}
}
