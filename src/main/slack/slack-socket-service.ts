// Custom build (slack-socket): binds Socket Mode to this host's runtime. Agent input and launches go
// through the same RPC methods the phone uses, dispatched in-process with a narrow allowlist.
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { AGENT_LAUNCH_METHODS } from '../runtime/rpc/methods/agent-launch'
import { TERMINAL_SEND_METHODS } from '../runtime/rpc/methods/terminal/terminal-send-method'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { getStoredSlackMetadata, loadStoredSlackTokens } from './slack-credential-store'
import { createSlackInboundHandler, type SlackDeliveryOutcome } from './slack-inbound'
import { getSlackNotificationChannel, sharedSlackThreadStore } from './slack-notification-channel'
import { asSlackRecord, SlackApiError, slackRequest } from './slack-request'
import { SlackSocket } from './slack-socket'

// Why: these mean Orca itself refused the input; anything else (timeouts, an SSH provider that is
// gone, a host that stopped answering) says nothing about the agent and is reported unverifiable.
const REFUSAL_CODES = new Set([
  'terminal_handle_stale',
  'terminal_not_found',
  'invalid_argument',
  'method_not_found',
  'terminal_input_locked'
])

let service: SlackSocket | null = null

function log(message: string): void {
  console.warn(`[slack] ${message}`)
}

function botToken(): string {
  const tokens = loadStoredSlackTokens()
  if (!tokens) {
    throw new SlackApiError('not_connected', 'Not connected to Slack.')
  }
  return tokens.botToken
}

export function slugForSlackTask(task: string): string {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
  return `slack-${words.join('-') || 'task'}`.slice(0, 40).replace(/-+$/, '')
}

const LAUNCH_ERROR_TEXT: Record<string, string> = {
  repo_not_found: 'Orca+ has no repo with that selector.',
  selector_ambiguous: 'that selector matches several repos; use its id:… instead.'
}

function describeLaunchError(code: string, message: string): string {
  return LAUNCH_ERROR_TEXT[message] ?? LAUNCH_ERROR_TEXT[code] ?? message
}

type RepoChoice = { id: string; displayName: string; path: string }

/** Turns the repo word from Slack into a selector; several same-named repos must be picked by id. */
export function resolveSlackRepo(word: string, repos: RepoChoice[]): string {
  if (/^(id|path|name):/.test(word)) {
    return word
  }
  const wanted = word.toLowerCase()
  const matches = repos.filter((repo) => repo.displayName.toLowerCase() === wanted)
  if (matches.length === 1) {
    return `id:${matches[0].id}`
  }
  if (matches.length === 0) {
    const known = repos.map((repo) => `\`${repo.displayName}\``).join(', ')
    throw new Error(`no repo is called \`${word}\`. Known repos: ${known || 'none'}.`)
  }
  const options = matches.map((repo) => `\`id:${repo.id}\` (${repo.path})`).join(', ')
  throw new Error(`several repos are called \`${word}\`; use one of ${options}.`)
}

async function sendToTerminal(
  runtime: OrcaRuntimeService,
  dispatcher: RpcDispatcher,
  paneKey: string,
  text: string
): Promise<SlackDeliveryOutcome> {
  const handle = runtime.getAgentStatusTerminalHandleForPaneKey(paneKey)
  if (!handle) {
    return { kind: 'refused', reason: 'the agent’s terminal is closed' }
  }
  let response
  try {
    response = await dispatcher.dispatch({
      id: randomUUID(),
      authToken: '',
      method: 'terminal.send',
      params: {
        terminal: handle,
        text,
        enter: true,
        agentPrompt: true,
        client: { id: 'orca-plus-slack', type: 'desktop' }
      }
    })
  } catch (error) {
    return { kind: 'unverifiable', reason: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) {
    return REFUSAL_CODES.has(response.error.code)
      ? { kind: 'refused', reason: response.error.message }
      : { kind: 'unverifiable', reason: response.error.message }
  }
  const send = asSlackRecord(asSlackRecord(response.result).send)
  return send.accepted === false
    ? { kind: 'refused', reason: 'the terminal did not accept input' }
    : { kind: 'delivered' }
}

function createService(store: Store, runtime: OrcaRuntimeService): SlackSocket {
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...TERMINAL_SEND_METHODS, ...AGENT_LAUNCH_METHODS]
  })
  const notifier = getSlackNotificationChannel(store, runtime)
  const handle = createSlackInboundHandler({
    readMetadata: getStoredSlackMetadata,
    threads: sharedSlackThreadStore,
    isAgent: isTuiAgent,
    log,
    sendToTerminal: (paneKey, text) => sendToTerminal(runtime, dispatcher, paneKey, text),
    startWork: async (request) => {
      const agent = request.agent ?? store.getSettings().defaultTuiAgent ?? 'claude'
      const name = slugForSlackTask(request.task)
      const repos = store.getRepos()
      const repoSelector = resolveSlackRepo(request.repo, repos)
      const response = await dispatcher.dispatch({
        id: randomUUID(),
        authToken: '',
        method: 'agent.launch',
        params: {
          agent,
          target: {
            kind: 'create-worktree',
            create: { repo: repoSelector, name, nameWasGenerated: true }
          },
          prompt: { text: request.task, delivery: 'submit' },
          launchSource: 'slack'
        }
      })
      if (!response.ok) {
        throw new Error(describeLaunchError(response.error.code, response.error.message))
      }
      const worktreeId = asSlackRecord(response.result).worktreeId
      if (typeof worktreeId !== 'string') {
        throw new Error('Orca did not report the new workspace.')
      }
      const repo = repos.find((entry) => `id:${entry.id}` === repoSelector)
      return { worktreeId, title: `${repo?.displayName ?? request.repo} / ${name}`, agent }
    },
    react: async (channel, ts, name) => {
      await slackRequest(botToken(), 'reactions.add', { channel, timestamp: ts, name }).catch(
        (error: unknown) => {
          if (!(error instanceof SlackApiError && error.code === 'already_reacted')) {
            throw error
          }
        }
      )
    },
    reply: async (channel, threadTs, text) => {
      await slackRequest(botToken(), 'chat.postMessage', {
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {})
      })
    },
    announce: (worktreeId, title, text) => notifier.announce(worktreeId, title, text)
  })
  return new SlackSocket({
    log,
    onEnvelope: handle,
    openUrl: async () => {
      const tokens = getStoredSlackMetadata() ? loadStoredSlackTokens() : null
      if (!tokens) {
        return null
      }
      const opened = await slackRequest(tokens.appToken, 'apps.connections.open')
      return typeof opened.url === 'string' ? opened.url : null
    }
  })
}

/** Starts Socket Mode once per process; later calls return the same service. */
export function installSlackSocketService(
  store: Store,
  runtime: OrcaRuntimeService | undefined
): SlackSocket | null {
  if (service || !runtime) {
    return service
  }
  service = createService(store, runtime)
  service.start()
  app.once('will-quit', () => service?.stop())
  return service
}

export function getSlackSocketService(): SlackSocket | null {
  return service
}
