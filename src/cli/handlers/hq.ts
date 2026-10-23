// Custom build (hq-plus-journal): `orca hq …` over the hq.* RPC.
import {
  parseHqJournalSince,
  type HqChatSendResult,
  type HqEventsResult,
  type HqReportResult,
  type HqThreadResult,
  type HqWhoami
} from '../../shared/hq-journal'
import type { HqRouteResult, HqSettleResult } from '../../shared/hq-routing'
import type {
  HqContextResult,
  HqRoomAddResult,
  HqSessionStartResult,
  HqStepResult,
  HqWhereResult
} from '../../shared/hq-context'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import {
  formatHqEvents,
  formatHqRoute,
  formatHqThread,
  formatHqWhere,
  formatHqWhoami
} from '../hq-format'

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
      room: getOptionalStringFlag(flags, 'room'),
      query: getOptionalStringFlag(flags, 'query')
    })
    printResult(result, json, formatHqEvents)
  },

  // Custom build (hq-plus-reports)
  'hq report': async ({ flags, client, json }) => {
    const options = getOptionalStringFlag(flags, 'options')
    const result = await client.call<HqReportResult>('hq.report', {
      ...caller(),
      done: getRequiredStringFlag(flags, 'done'),
      ask: getOptionalStringFlag(flags, 'ask'),
      options: options?.split('|').map((option) => option.trim()),
      next: getOptionalStringFlag(flags, 'next'),
      blockedBy: getOptionalStringFlag(flags, 'blocked-by'),
      links: getRepeatedStringFlag(flags, 'link'),
      address: getOptionalStringFlag(flags, 'address')
    })
    printResult(result, json, (r) => `Reported in ${r.address} (${r.entry.needs}).  ${r.entry.id}`)
  },

  'hq thread': async ({ flags, client, json }) => {
    const result = await client.call<HqThreadResult>('hq.thread', {
      ...caller(),
      address: getOptionalStringFlag(flags, 'address')
    })
    printResult(result, json, formatHqThread)
  },

  'chat send': async ({ flags, client, json }) => {
    const result = await client.call<HqChatSendResult>('chat.send', {
      ...caller(),
      address: getRequiredStringFlag(flags, 'address'),
      text: getRequiredStringFlag(flags, 'text'),
      replyTo: getOptionalStringFlag(flags, 'reply-to')
    })
    printResult(result, json, (r) =>
      r.reopened
        ? `Brought the closed chat back and handed it the message.  ${r.entry.id}`
        : `Handed the message to the chat on ${r.entry.address}.  ${r.entry.id}`
    )
  },

  // Custom build (hq-plus-routing)
  'hq route': async ({ flags, client, json }) => {
    const sinceFlag = getOptionalStringFlag(flags, 'since')
    const since = sinceFlag === undefined ? undefined : parseHqJournalSince(sinceFlag, Date.now())
    if (since === null) {
      throw new Error(`--since takes 7d, 2w or an ISO date, got "${sinceFlag}"`)
    }
    const result = await client.call<HqRouteResult>('hq.route', {
      ...caller(),
      run: flags.get('run') === true,
      now: flags.get('now') === true,
      since
    })
    printResult(result, json, formatHqRoute)
  },

  'hq settle': async ({ flags, client, json }) => {
    const done = flags.get('done') === true
    const dropped = flags.get('dropped') === true
    if (done === dropped) {
      throw new Error('Pass one of --done or --dropped')
    }
    const result = await client.call<HqSettleResult>('hq.settle', {
      ...caller(),
      id: getRequiredStringFlag(flags, 'id'),
      status: done ? 'done' : 'dropped',
      commit: getOptionalStringFlag(flags, 'commit'),
      why: getOptionalStringFlag(flags, 'why')
    })
    printResult(result, json, (r) =>
      r.settled ? `Closed ${r.entryId} as ${r.status}.` : `${r.entryId} was already closed.`
    )
  },

  // Custom build (hq-plus-context)
  'hq context': async ({ flags, client, json }) => {
    if (flags.get('session-start') === true) {
      const result = await client.call<HqSessionStartResult>('hq.context', {
        ...caller(),
        sessionStart: true
      })
      printResult(result, json, (r) => r.text)
      return
    }
    const result = await client.call<HqContextResult>('hq.context', {
      ...caller(),
      project: getOptionalStringFlag(flags, 'project')
    })
    printResult(result, json, (r) => r.lines.join('\n'))
  },

  'hq step': async ({ flags, client, json }) => {
    const done = flags.get('done') === true
    if (done === (flags.get('undo') === true)) {
      throw new Error('Pass one of --done or --undo')
    }
    const result = await client.call<HqStepResult>('hq.step', {
      ...caller(),
      project: getOptionalStringFlag(flags, 'project'),
      id: getRequiredStringFlag(flags, 'id'),
      done
    })
    printResult(result, json, (r) =>
      r.changed
        ? `${r.project}: step ${r.step.id} «${r.step.title}» is now ${r.step.done ? 'done' : 'open'}.`
        : `${r.project}: step ${r.step.id} was already ${r.step.done ? 'done' : 'open'}.`
    )
  },

  'hq where': async ({ flags, client, json }) => {
    const result = await client.call<HqWhereResult>('hq.where', {
      ...caller(),
      question: getRequiredStringFlag(flags, 'question')
    })
    printResult(result, json, formatHqWhere)
  },

  'hq workspace add': async ({ flags, client, json }) => {
    const result = await client.call<HqRoomAddResult>('hq.workspaceAdd', {
      ...caller(),
      name: getRequiredStringFlag(flags, 'name'),
      slug: getOptionalStringFlag(flags, 'slug'),
      color: getOptionalStringFlag(flags, 'color'),
      messenger: getOptionalStringFlag(flags, 'messenger'),
      tasks: getOptionalStringFlag(flags, 'tasks')
    })
    printResult(result, json, (r) => `Room ${r.slug} created: ${r.created.join(', ')}`)
  },

  'hq whoami': async ({ client, json }) => {
    const result = await client.call<HqWhoami>('hq.whoami', caller())
    printResult(result, json, formatHqWhoami)
  }
}
