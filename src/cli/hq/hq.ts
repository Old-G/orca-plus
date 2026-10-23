// Custom build (hq-plus-journal): `orca hq …` over the hq.* RPC.
import { parseHqJournalSince, type HqEventsResult, type HqWhoami } from '../../shared/hq-journal'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { formatHqEvents, formatHqWhoami } from '../hq-format'

/** Who is asking, as the agent's environment says; the host turns it into a room. */
function caller(): { callerSessionId?: string; callerWorktreeId?: string; callerCwd: string } {
  return {
    callerSessionId: process.env.ORCA_AGENT_SESSION_ID || undefined,
    callerWorktreeId: process.env.ORCA_WORKTREE_ID || process.env.ORCA_WORKSPACE_ID || undefined,
    callerCwd: process.cwd()
  }
}

export const HQ_HANDLERS: Record<string, CommandHandler> = {
  'hq events': async ({ flags, client, json }) => {
    const sinceFlag = getOptionalStringFlag(flags, 'since')
    const since = sinceFlag === undefined ? undefined : parseHqJournalSince(sinceFlag, Date.now())
    if (since === null) {
      throw new Error(`--since takes 90m, 24h, 7d, 2w or an ISO date, got "${sinceFlag}"`)
    }
    const limitFlag = getOptionalStringFlag(flags, 'limit')
    const limit = limitFlag === undefined ? undefined : Number(limitFlag)
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error('--limit must be a positive whole number')
    }
    const result = await client.call<HqEventsResult>('hq.events', {
      ...caller(),
      since,
      project: getOptionalStringFlag(flags, 'project'),
      needs: getOptionalStringFlag(flags, 'needs'),
      kind: getOptionalStringFlag(flags, 'kind'),
      limit,
      room: getOptionalStringFlag(flags, 'room')
    })
    printResult(result, json, formatHqEvents)
  },

  'hq whoami': async ({ client, json }) => {
    const result = await client.call<HqWhoami>('hq.whoami', caller())
    printResult(result, json, formatHqWhoami)
  }
}
