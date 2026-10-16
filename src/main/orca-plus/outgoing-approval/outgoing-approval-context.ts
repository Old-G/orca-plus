// Custom build (outgoing-approval-target): names what a held call's card shows — the Slack channel or
// person it reaches, the thread message it answers, the agent chat that sends it. Each part is best
// effort: whatever cannot be named keeps the raw id the card showed before.
import type { HqSlackScoutIndex } from '../../hq-today/hq-slack-scout-index'
import type { OutgoingApprovalContext } from '../../../shared/outgoing-approval/outgoing-approval-bell'
import { readInputString } from '../../../shared/outgoing-approval/outgoing-action'
import type { PulseDraft } from '../../../shared/pulse-types'

export type OutgoingContextSources = {
  slackName: (id: string) => Promise<string | null>
  scout: () => Promise<HqSlackScoutIndex | null>
  chatName: (agentSessionId: string) => string | null
}

const QUOTE_MAX = 80

function quoted(said: string): string {
  const line = said.replace(/\s+/g, ' ').trim()
  return `«${line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1)}…` : line}»`
}

async function slackTargetName(
  target: string,
  sources: OutgoingContextSources,
  scout: HqSlackScoutIndex | null
): Promise<string | null> {
  const ids = target.split(',').map((id) => id.trim())
  const names = await Promise.all(
    ids.map(async (id) => (await sources.slackName(id)) ?? scout?.channelNames.get(id) ?? null)
  )
  return names.every((name) => name === null)
    ? null
    : names.map((name, index) => name ?? ids[index]).join(', ')
}

export async function describeOutgoingDraft(
  draft: PulseDraft,
  sources: OutgoingContextSources
): Promise<OutgoingApprovalContext> {
  const call = draft.call
  const chatName = call?.agentSessionId ? sources.chatName(call.agentSessionId) : null
  if (!call || !/slack/i.test(call.service) || !draft.target) {
    return { chatName }
  }
  const scout = await sources.scout().catch(() => null)
  const threadTs = readInputString(call.toolInput, 'thread_ts')
  const channelId = draft.target.split(',')[0]?.trim()
  const thread = threadTs && channelId ? scout?.threads.get(`${channelId}:${threadTs}`) : undefined
  const replyingTo = thread
    ? [thread.author, thread.said ? quoted(thread.said) : null].filter(Boolean).join(': ') || null
    : null
  return {
    chatName,
    targetName: await slackTargetName(draft.target, sources, scout),
    replyingTo
  }
}
