import type { GmailResult, GmailStatus } from '../../shared/gmail-types'

/** Custom build (hq-mail-intake): the owner's Gmail, read for GitLab and ClickUp notifications. */
export type GmailApi = {
  status: () => Promise<GmailStatus>
  /** Opens a file picker for the Console's client JSON; null when the owner cancels. */
  importClient: () => Promise<GmailResult | null>
  connect: () => Promise<GmailResult>
  disconnect: () => Promise<void>
}
