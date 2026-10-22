// Custom build (hq-mail-intake): what Settings shows about the Gmail connection.
export type GmailStatus = {
  /** The OAuth client file was imported. */
  clientSet: boolean
  connected: boolean
  email: string | null
  /** The last read's failure, cleared by the next success. */
  error: string | null
}

export type GmailResult = { ok: true } | { ok: false; error: string }
