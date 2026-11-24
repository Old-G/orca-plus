// Custom build (hq-plus-reports): a handoff's new chat takes over the old one's thread — its address,
// role and open questions. Custom build (hq-handoff-parked, T7 25.11): also when the old chat had no
// address; the parent link and the `session.handoff` row are what park it.
import { HQ_JOURNAL_KIND, HQ_JOURNAL_MAX_LIMIT } from '../../shared/hq-journal'
import { journalEntryAsInput } from './hq-journal-adapters'
import { hqCarryChatRole } from './hq-journal-chat-role'
import type { HqThreadsDeps } from './hq-journal-threads'

/** False when nothing was written: HQ+ is off, or Orca+ never saw the old chat. */
export function hqHandOff(
  deps: Pick<HqThreadsDeps, 'pulse' | 'enabled' | 'now'>,
  fromSessionId: string,
  toSessionId: string
): boolean {
  const from = deps.pulse.getSession(fromSessionId)
  if (!from || !deps.enabled()) {
    return false
  }
  const at = deps.now()
  deps.pulse.noteSessions([
    { ...from, sessionId: toSessionId, parentSessionId: fromSessionId, state: 'working', at }
  ])
  hqCarryChatRole(deps.pulse, fromSessionId, toSessionId, at)
  // Why: the new chat carries the old one's open questions; they are no longer the owner's move there.
  const asked = deps.pulse
    .list({
      sessionId: fromSessionId,
      needs: 'owner',
      status: 'open',
      limit: HQ_JOURNAL_MAX_LIMIT
    })
    .filter((entry) => entry.kind === HQ_JOURNAL_KIND.chatReport && entry.dedupeKey)
  deps.pulse.record([
    ...asked.map((entry) => journalEntryAsInput(entry, { status: 'done' })),
    {
      workspace: from.workspace,
      placement: 'firm',
      kind: HQ_JOURNAL_KIND.sessionHandoff,
      at,
      project: from.project,
      address: from.address,
      sessionId: toSessionId,
      personId: null,
      title: `Handoff: a new chat continues ${from.address ?? fromSessionId.slice(0, 8)}`,
      needs: 'nobody',
      status: 'done',
      replyTo: null,
      refKind: 'session',
      refId: fromSessionId,
      source: 'handoff',
      dedupeKey: `session.handoff:${fromSessionId}:${toSessionId}`
    }
  ])
  return true
}
