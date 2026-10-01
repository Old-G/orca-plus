// Custom build (claude-subscriptions): a Claude chat at rest moves to another subscription's config
// dir; its next start resumes the same conversation there (transcripts are shared between the dirs).
import { agentSessionLeaseIsReleased } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'

export type AgentSessionAccountHomeReplacement = {
  sessionId: string
  fence: number
  accountHome: AgentSessionRecord['accountHome']
  now: number
}

export function replaceAgentSessionRecordAccountHome(
  record: AgentSessionRecord,
  replacement: AgentSessionAccountHomeReplacement
): AgentSessionRecord {
  const { lease } = record
  // Why: a live child keeps the old dir's login, so the record may name a new one only with none running.
  if (
    lease.runtimeFence !== replacement.fence ||
    !agentSessionLeaseIsReleased(lease) ||
    lease.ownerProcess !== null
  ) {
    throw agentSessionRefusalError('agent_session_ownership_unknown', { reason: 'leaseMoved' })
  }
  if (
    record.provider !== 'claude' ||
    record.accountHome.variable !== 'CLAUDE_CONFIG_DIR' ||
    replacement.accountHome.variable !== 'CLAUDE_CONFIG_DIR'
  ) {
    throw agentSessionRefusalError('structured_agent_session_unsupported', {
      reason: 'hostUnsupported'
    })
  }
  return { ...record, accountHome: { ...replacement.accountHome }, updatedAt: replacement.now }
}
