// Custom build (hq-sessions-find, A6+A7): `orca hq sessions` filters, so an agent asks for the one chat
// it needs instead of reading every chat the owner ever had (65+ KB). Pure: the command filters what
// `hq.sessions` returned; nothing here reaches the app.
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from './arguments/flags'
import type { HqLiveSession, HqSessionsResult } from '../shared/hq-sessions'

export type HqSessionsFilter = {
  /** Comma list of working|waiting|done|closed. */
  state?: string
  role?: string
  /** Substring of the project name. */
  project?: string
  address?: string
  name?: string
  /** Words that must each appear in the name, address, project or session id. */
  find?: string
  limit?: number
}

/** Default for the plain call: chats that are open or mid-turn, newest first, this many. */
export const HQ_SESSIONS_DEFAULT_LIMIT = 20

export function hqSessionsFilterOfFlags(flags: Map<string, string | boolean>): HqSessionsFilter {
  return {
    state: getOptionalStringFlag(flags, 'state'),
    role: getOptionalStringFlag(flags, 'role'),
    project: getOptionalStringFlag(flags, 'project'),
    address: getOptionalStringFlag(flags, 'address'),
    name: getOptionalStringFlag(flags, 'name'),
    find: getOptionalStringFlag(flags, 'find'),
    limit: getOptionalPositiveIntegerFlag(flags, 'limit')
  }
}

export function hasHqSessionsFilter(filter: HqSessionsFilter): boolean {
  return Object.values(filter).some((value) => value !== undefined)
}

function has(text: string | null, needle: string): boolean {
  return (text ?? '').toLowerCase().includes(needle.toLowerCase())
}

function matches(session: HqLiveSession, filter: HqSessionsFilter): boolean {
  const states = filter.state
    ?.split(',')
    .map((state) => state.trim().toLowerCase())
    .filter(Boolean)
  if (states?.length && !states.includes(session.state)) {
    return false
  }
  if (filter.role && session.role?.toLowerCase() !== filter.role.toLowerCase()) {
    return false
  }
  if (filter.project && !has(session.project, filter.project)) {
    return false
  }
  if (filter.address && !has(session.address, filter.address)) {
    return false
  }
  if (filter.name && !has(session.name, filter.name)) {
    return false
  }
  const words = filter.find?.split(/\s+/).filter(Boolean) ?? []
  const haystack = [session.name, session.address, session.project, session.sessionId].join('\n')
  return words.every((word) => has(haystack, word))
}

/** The sessions the filter keeps, in the order given (newest first from the app); `limit` cuts the tail. */
export function filterHqSessions(
  sessions: readonly HqLiveSession[],
  filter: HqSessionsFilter
): HqLiveSession[] {
  const kept = sessions.filter((session) => matches(session, filter))
  return filter.limit === undefined ? kept : kept.slice(0, filter.limit)
}

/** The result with its sessions filtered; `--json` prints this, so it keeps the old shape. */
export function filterHqSessionsResult(
  result: HqSessionsResult,
  filter: HqSessionsFilter
): HqSessionsResult {
  return { ...result, sessions: filterHqSessions(result.sessions, filter) }
}
