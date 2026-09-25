// Custom build (slack-socket): what Orca+ does with a message Slack pushes to it. Only the owner
// saved at connect time is obeyed; everyone else is ignored without a reply.
import type { SlackStoredMetadata } from './slack-credential-store'
import type { SlackEnvelope } from './slack-socket'
import type { SlackThreadStore } from './slack-thread-store'

export type SlackDeliveryOutcome =
  | { kind: 'delivered' }
  | { kind: 'refused'; reason: string }
  /** The host that runs the agent could not confirm; never reported as delivered or lost. */
  | { kind: 'unverifiable'; reason: string }

export type SlackStartRequest = { repo: string; agent: string | null; task: string }

export type SlackInboundDeps = {
  readMetadata: () => SlackStoredMetadata | null
  threads: SlackThreadStore
  sendToTerminal: (paneKey: string, text: string) => Promise<SlackDeliveryOutcome>
  startWork: (
    request: SlackStartRequest
  ) => Promise<{ worktreeId: string; title: string; agent: string }>
  isAgent: (value: string) => boolean
  react: (channel: string, ts: string, name: string) => Promise<void>
  /** threadTs null posts at the top level of the channel. */
  reply: (channel: string, threadTs: string | null, text: string) => Promise<void>
  announce: (worktreeId: string, title: string, text: string) => Promise<void>
  log?: (message: string) => void
}

const USAGE = 'Usage: `/orca <repo> [agent] <task>` — or DM me `new <repo> [agent]: <task>`.'

/** Slack escapes &, < and > and wraps links, mentions and channels in <…>. */
export function slackTextToPlain(text: string): string {
  return text
    .replace(/<(https?:\/\/[^|>]+)\|[^>]*>/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<[@#!][^|>]*\|([^>]*)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/** `<repo> [agent] <task>`; the optional agent word only counts when it names a known agent. */
export function parseStartCommand(
  text: string,
  isAgent: (value: string) => boolean
): SlackStartRequest | null {
  const match = /^(\S+)\s+([\s\S]+)$/.exec(text.trim())
  if (!match) {
    return null
  }
  const [, rawRepo, rest] = match
  // Why: copying a `code` span in Slack keeps its backticks; quotes and emphasis are just as common.
  const repo = rawRepo.replace(/^[`'"*_]+|[`'"*_]+$/g, '')
  if (!repo) {
    return null
  }
  const agentMatch = /^(\S+)\s+([\s\S]+)$/.exec(rest.trim())
  if (agentMatch && isAgent(agentMatch[1].toLowerCase())) {
    return { repo, agent: agentMatch[1].toLowerCase(), task: agentMatch[2].trim() }
  }
  return { repo, agent: null, task: rest.trim() }
}

function describe(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

export function createSlackInboundHandler(deps: SlackInboundDeps) {
  const background = (work: Promise<void>): void => {
    void work.catch((error: unknown) => deps.log?.(`inbound failed: ${describe(error)}`))
  }

  const start = async (request: SlackStartRequest, feedback: (text: string) => Promise<void>) => {
    try {
      const started = await deps.startWork(request)
      await deps.announce(
        started.worktreeId,
        started.title,
        `:rocket: Started ${started.agent} from Slack: ${request.task}`
      )
    } catch (error) {
      await feedback(`:x: Could not start work in \`${request.repo}\`: ${describe(error)}`)
    }
  }

  const answerAgent = async (event: {
    channel: string
    ts: string
    threadTs: string
    text: string
  }): Promise<void> => {
    const match = deps.threads.findByTs(event.channel, event.threadTs)
    if (!match) {
      return
    }
    const say = (text: string) => deps.reply(event.channel, event.threadTs, text)
    if (!match.pane) {
      await say('No agent has posted in this workspace yet, so there is nobody to answer.')
      return
    }
    if (match.pane.surface === 'agent-session') {
      await say('This agent runs as a native chat; answer it in Orca+ for now.')
      return
    }
    await deps.react(event.channel, event.ts, 'eyes')
    const outcome = await deps.sendToTerminal(match.pane.paneKey, event.text)
    if (outcome.kind === 'delivered') {
      await deps.react(event.channel, event.ts, 'white_check_mark')
      return
    }
    await deps.react(event.channel, event.ts, outcome.kind === 'refused' ? 'x' : 'grey_question')
    await say(
      outcome.kind === 'refused'
        ? `:x: Not delivered: ${outcome.reason}`
        : `:grey_question: Delivery could not be confirmed (${outcome.reason}). Not retried — check the agent in Orca+.`
    )
  }

  const onMessage = (metadata: SlackStoredMetadata, event: Record<string, unknown>): void => {
    // Why: edits, joins and our own bot posts arrive as subtypes or carry a bot_id.
    if (event.subtype !== undefined || event.bot_id !== undefined) {
      return
    }
    if (event.user !== metadata.owner.id) {
      if (typeof event.user === 'string') {
        deps.log?.(`ignored a message from ${event.user}`)
      }
      return
    }
    const channel = typeof event.channel === 'string' ? event.channel : null
    const ts = typeof event.ts === 'string' ? event.ts : null
    const text = typeof event.text === 'string' ? slackTextToPlain(event.text) : ''
    if (!channel || !ts || !text) {
      return
    }
    const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : null
    if (threadTs && threadTs !== ts) {
      background(answerAgent({ channel, ts, threadTs, text }))
      return
    }
    // Why: top-level chatter in a channel is never a command; only the owner's DM is.
    if (channel !== metadata.dmChannelId) {
      return
    }
    const command = /^new\s+([\s\S]+)$/i.exec(text)
    const parsed = command
      ? parseStartCommand(command[1].replace(/^(\S+(?:\s+\S+)?):\s*/, '$1 '), deps.isAgent)
      : null
    background(
      parsed
        ? start(parsed, (reply) => deps.reply(channel, null, reply))
        : deps.reply(channel, null, USAGE)
    )
  }

  return async (envelope: SlackEnvelope): Promise<Record<string, unknown> | undefined> => {
    const metadata = deps.readMetadata()
    if (!metadata) {
      return undefined
    }
    if (envelope.type === 'events_api') {
      const event = envelope.payload.event
      if (event && typeof event === 'object' && !Array.isArray(event)) {
        const record = Object.fromEntries(Object.entries(event))
        if (record.type === 'message') {
          onMessage(metadata, record)
        }
      }
      return undefined
    }
    if (envelope.type === 'slash_commands') {
      if (envelope.payload.user_id !== metadata.owner.id) {
        return { text: 'Only the owner of this Orca+ can start work from Slack.' }
      }
      const text =
        typeof envelope.payload.text === 'string' ? slackTextToPlain(envelope.payload.text) : ''
      const parsed = parseStartCommand(text, deps.isAgent)
      if (!parsed) {
        return { text: USAGE }
      }
      background(start(parsed, (reply) => deps.reply(metadata.dmChannelId, null, reply)))
      return { text: `On it: starting work in \`${parsed.repo}\`…` }
    }
    return undefined
  }
}
