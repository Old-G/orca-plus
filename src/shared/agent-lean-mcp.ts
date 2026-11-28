// Custom build (lean-mcp, L4 of the AI-UX wave 2, owner 28.11): worker and review chats can start
// without the MCP servers the owner does not use there. L2 measured the tool list and server
// instructions of Gmail, Calendar, GA/GMC/GSC/Ads, Zoho, Odoo, Woo and Meetings at ~9% of the week.
// `full` (default, and anything unknown) starts every chat with every server, as before; `lean` hides
// the servers below from chats launched with --role worker|review. A lead, a sub-lead and the
// owner's own chats are never narrowed. The rules go out as `--disallowedTools mcp__<server>`, the
// same way a room's `mcp.deny` does (hq-room-mcp).
import type { HqChatRole } from './hq-chat-role'
import { hqRoomMcpDenyRules } from './hq-room-mcp'

export type AgentMcpProfile = 'full' | 'lean'

export const AGENT_MCP_PROFILES: readonly AgentMcpProfile[] = ['full', 'lean']

/** Roles the lean profile narrows. */
export const LEAN_MCP_ROLES: readonly HqChatRole[] = ['worker', 'review']

/** Servers a lean chat starts without, by the name Claude gives their tools (`/mcp` shows them as
 *  `claude.ai Gmail`). Exact names: a connector the owner adds later is not hidden by surprise. */
export const DEFAULT_LEAN_MCP_DENY: readonly string[] = [
  'claude_ai_Gmail',
  'claude_ai_Google_Calendar',
  'claude_ai_LH_GA_MCP',
  'claude_ai_LH_GMC_MCP',
  'claude_ai_LH_GSC_MCP',
  'claude_ai_Google_Ads_MCP',
  'claude_ai_Zoho_Desk',
  'claude_ai_Zoho_CRM',
  'claude_ai_LH-Odoo',
  'claude_ai_LH_Woo_MCP',
  'claude_ai_Meetings'
]

type LeanMcpSettings = { agentMcpProfile?: unknown; agentLeanMcpDeny?: unknown }

export function agentMcpProfile(settings: LeanMcpSettings | null | undefined): AgentMcpProfile {
  return settings?.agentMcpProfile === 'lean' ? 'lean' : 'full'
}

/** `--disallowedTools` rules for a chat of this role: none unless the profile is lean and the role is
 *  a worker or a review. `agentLeanMcpDeny` (a list in settings) replaces the default list; an empty
 *  or damaged one falls back to it, so lean never means «nothing hidden» by accident. */
export function leanMcpDenyRules(
  settings: LeanMcpSettings | null | undefined,
  role: HqChatRole | null
): string[] {
  if (agentMcpProfile(settings) !== 'lean' || !role || !LEAN_MCP_ROLES.includes(role)) {
    return []
  }
  const custom = Array.isArray(settings?.agentLeanMcpDeny)
    ? settings.agentLeanMcpDeny.filter((entry): entry is string => typeof entry === 'string')
    : []
  const rules = hqRoomMcpDenyRules(custom)
  return rules.length > 0 ? rules : hqRoomMcpDenyRules(DEFAULT_LEAN_MCP_DENY)
}
