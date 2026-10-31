// Custom build (hq-request-ledger): what an agent sent, read from the call's own result after it ran —
// a Slack message, a ClickUp comment, an MR note, a letter, approved or not — put into its conversation
// at its real place and held by the chat that sent it, so the answer later finds that chat. A held call
// was put in at approval where Orca+ expected it to go (`sent:<decision>`); the result supersedes that
// row, so one message is in the ledger once.
import type { HqLedgerResult } from '../../../shared/hq-ledger'
import type { PulseCore } from './pulse-core'
import { ingestLedgerSignal } from './pulse-ledger'

export const HQ_SENT_READER = 'sent'

export type HqAgentSend = {
  /** Conversation key, from `hqPlaceKey`'s forms. */
  key: string
  /** The source's own id of the message: a Slack ts and a Gmail id as their readers keep them,
   *  `comment:<id>` for ClickUp, `note:<id>` for GitLab. */
  ts: string
  at: number
  text: string
  link: string | null
  title: string
  project: string | null
  /** The sending chat (`ORCA_AGENT_SESSION_ID`, as a waiting's `agentSessionId`); null when unknown. */
  sessionId: string | null
  /** The provider session and tool call, which name the held call it may have been. */
  call: { sessionId: string | null; toolUseId: string | null }
}

/** The approval this exact call went out under; the gate keys a held call by session and tool call. */
export function approvalOfCall(core: PulseCore, call: HqAgentSend['call']): string | null {
  if (!call.sessionId || !call.toolUseId) {
    return null
  }
  const row = core.db
    .prepare(
      `SELECT d.id FROM decisions d JOIN drafts r ON r.id = d.draft_id
        WHERE r.fingerprint = ? AND d.kind = 'approval' AND d.outcome IN ('approved', 'edited')
        ORDER BY d.decided_at DESC LIMIT 1`
    )
    .get(`gate:${call.sessionId}:${call.toolUseId}`)
  return row ? String(row.id) : null
}

/** Takes the approval's own row out, and the conversation that row alone made at another place. */
function dropApprovalRow(core: PulseCore, decisionId: string, key: string): void {
  core.transaction(() => {
    const rows = core.db
      .prepare(
        `SELECT m.conversation_id AS id, c.key FROM conversation_messages m
           JOIN conversations c ON c.id = m.conversation_id WHERE m.ts = ?`
      )
      .all(`sent:${decisionId}`)
    for (const row of rows) {
      const id = String(row.id)
      core.db
        .prepare('DELETE FROM conversation_messages WHERE conversation_id = ? AND ts = ?')
        .run(id, `sent:${decisionId}`)
      const left = core.db
        .prepare('SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?')
        .get(id)
      if (Number(left?.n ?? 0) === 0 && String(row.key) !== key) {
        core.db
          .prepare('UPDATE waitings SET conversation_id = NULL WHERE conversation_id = ?')
          .run(id)
        core.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      }
      core.emit('conversation.updated', 'conversation', id, { superseded: decisionId })
    }
  })
}

/** One message an agent sent, at its real place; idempotent per message. */
export function recordAgentSend(core: PulseCore, send: HqAgentSend): HqLedgerResult {
  const decisionId = approvalOfCall(core, send.call)
  if (decisionId) {
    dropApprovalRow(core, decisionId, send.key)
  }
  return ingestLedgerSignal(core, {
    key: send.key,
    ts: send.ts,
    at: send.at,
    author: null,
    authorId: null,
    fromOwner: true,
    text: send.text,
    link: send.link,
    reader: HQ_SENT_READER,
    forOwner: false,
    project: send.project,
    title: send.title,
    sessionId: send.sessionId,
    decisionId
  })
}
