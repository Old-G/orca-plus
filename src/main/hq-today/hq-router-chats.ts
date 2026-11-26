// Custom build (hq-router, plan router T1/T4): the open chats a routed message may go to, as the router
// reads them — with whether each is open, done or closed (owner 26.11: open chats first).
import { hqRouterChatState, type HqRouterChat } from '../../shared/hq-router'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

/** Why a month: a chat left open a week is still where its thread's answer belongs (as the ledger). */
const CHATS_WINDOW_MS = 30 * 24 * 60 * 60_000
const REPORTS_PER_CHAT = 2

const ROLES = new Set(['lead', 'sublead', 'worker', 'review'])

export function hqRouterChats(
  runtime: OrcaRuntimeService,
  now: number,
  /** Chats with a tab open; null when the workspace session could not be read. */
  tabs: ReadonlySet<string> | null
): HqRouterChat[] {
  const since = now - CHATS_WINDOW_MS
  const reports = new Map<string, string[]>()
  for (const entry of runtime.pulseListJournal({ kind: 'chat.report', since, limit: 300 })) {
    const held = entry.sessionId ? (reports.get(entry.sessionId) ?? []) : null
    if (entry.sessionId && held && held.length < REPORTS_PER_CHAT) {
      reports.set(entry.sessionId, [...held, entry.title])
    }
  }
  const router = runtime.pulseRouter()
  const open = runtime.pulseListRecentSessions(since).filter(
    (session) =>
      session.closedAt === null &&
      session.state !== 'closed' &&
      // Why: a chat that handed off sends its messages on; its successor is the one to offer.
      runtime.pulseLiveSessionOf(session.sessionId) === session.sessionId
  )
  const ids = new Set(open.map((session) => session.sessionId))
  return open.map((session) => {
    const role = router.roleOf(session.sessionId)
    const lead = router.leadOf(session.sessionId)
    return {
      sessionId: session.sessionId,
      title:
        runtime.openedAgentSessionRecordStore()?.getRecord(session.sessionId)?.conversationName ||
        session.address ||
        session.sessionId,
      project: session.project,
      repoId: session.worktreeId?.split('::')[0] || null,
      role: role && ROLES.has(role) ? (role as HqRouterChat['role']) : null,
      leadId: lead && ids.has(lead) && lead !== session.sessionId ? lead : null,
      taskRef: session.taskRef,
      lastReport: reports.get(session.sessionId)?.join(' / ') ?? null,
      waitsOnAuthor: [],
      lastActivityAt: session.lastActivityAt,
      state: hqRouterChatState(session.state, tabs ? tabs.has(session.sessionId) : null)
    }
  })
}
