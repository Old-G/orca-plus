import { describe, expect, it, vi } from 'vitest'
import {
  createSlackInboundHandler,
  parseStartCommand,
  slackTextToPlain,
  type SlackInboundDeps
} from './slack-inbound'
import type { SlackStoredMetadata } from './slack-credential-store'
import type { SlackThreadPane } from './slack-thread-store'

const metadata: SlackStoredMetadata = {
  version: 1,
  teamId: 'T1',
  teamName: 'Lev',
  bot: { id: 'UBOT', name: 'orca-plus' },
  owner: { id: 'UOWNER', name: 'Gleb' },
  dmChannelId: 'D1',
  target: { kind: 'dm' },
  updatedAt: ''
}

const isAgent = (value: string) => ['claude', 'codex'].includes(value)

function harness(pane: SlackThreadPane | null = { paneKey: 'tab:leaf', surface: 'terminal' }) {
  const deps = {
    readMetadata: () => metadata,
    threads: {
      get: () => null,
      set: () => {},
      forget: () => {},
      setPane: () => {},
      findByTs: (channel: string, ts: string) =>
        channel === 'D1' && ts === '100.1' ? { worktreeId: 'wt-1', pane } : null
    },
    isAgent,
    sendToTerminal: vi.fn<SlackInboundDeps['sendToTerminal']>(async () => ({ kind: 'delivered' })),
    startWork: vi.fn<SlackInboundDeps['startWork']>(async () => ({
      worktreeId: 'wt-new',
      title: 'orca / slack-fix',
      agent: 'claude'
    })),
    react: vi.fn<SlackInboundDeps['react']>(async () => {}),
    reply: vi.fn<SlackInboundDeps['reply']>(async () => {}),
    announce: vi.fn<SlackInboundDeps['announce']>(async () => {})
  } satisfies SlackInboundDeps
  return { deps, handle: createSlackInboundHandler(deps) }
}

function message(event: Record<string, unknown>) {
  return {
    envelopeId: 'e1',
    type: 'events_api',
    payload: { event: { type: 'message', channel: 'D1', ts: '200.1', user: 'UOWNER', ...event } }
  }
}

describe('Slack replies to agents', () => {
  it('delivers the owner’s thread reply to the pane that last posted there', async () => {
    const { deps, handle } = harness()
    await handle(message({ thread_ts: '100.1', text: 'yes, run &lt;it&gt;' }))
    await vi.waitFor(() => expect(deps.react).toHaveBeenCalledTimes(2))
    expect(deps.sendToTerminal).toHaveBeenCalledWith('tab:leaf', 'yes, run <it>')
    expect(deps.react.mock.calls.map((call) => call[2])).toEqual(['eyes', 'white_check_mark'])
  })

  it('ignores other people, bots and edits', async () => {
    const { deps, handle } = harness()
    await handle(message({ thread_ts: '100.1', text: 'hi', user: 'USOMEONE' }))
    await handle(message({ thread_ts: '100.1', text: 'hi', bot_id: 'B1' }))
    await handle(message({ thread_ts: '100.1', text: 'hi', subtype: 'message_changed' }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(deps.sendToTerminal).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('says delivery is unverifiable instead of claiming success or loss', async () => {
    const { deps, handle } = harness()
    deps.sendToTerminal.mockResolvedValueOnce({
      kind: 'unverifiable',
      reason: 'ssh host unreachable'
    })
    await handle(message({ thread_ts: '100.1', text: 'continue' }))
    await vi.waitFor(() => expect(deps.reply).toHaveBeenCalled())
    expect(deps.reply.mock.calls[0][2]).toMatch(/could not be confirmed \(ssh host unreachable\)/)
    expect(deps.react.mock.calls.map((call) => call[2])).toEqual(['eyes', 'grey_question'])
  })

  it('does not type into a native chat', async () => {
    const { deps, handle } = harness({ paneKey: 'tab:s', surface: 'agent-session' })
    await handle(message({ thread_ts: '100.1', text: 'continue' }))
    await vi.waitFor(() => expect(deps.reply).toHaveBeenCalled())
    expect(deps.sendToTerminal).not.toHaveBeenCalled()
  })
})

describe('starting work from Slack', () => {
  it('starts from a DM `new` command and opens the workspace thread', async () => {
    const { deps, handle } = harness()
    await handle(message({ text: 'new orca codex: fix the login bug' }))
    await vi.waitFor(() => expect(deps.announce).toHaveBeenCalled())
    expect(deps.startWork).toHaveBeenCalledWith({
      repo: 'orca',
      agent: 'codex',
      task: 'fix the login bug'
    })
    expect(deps.announce.mock.calls[0][0]).toBe('wt-new')
  })

  it('answers other DMs with usage and ignores top-level channel chatter', async () => {
    const { deps, handle } = harness()
    await handle(message({ text: 'hello there' }))
    await handle(message({ text: 'new orca: fix', channel: 'C1' }))
    await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(1))
    expect(deps.reply.mock.calls[0][2]).toMatch(/Usage/)
    // Why: a threaded answer would push the user into a thread, where Slack refuses /orca.
    expect(deps.reply.mock.calls[0][1]).toBeNull()
    expect(deps.startWork).not.toHaveBeenCalled()
  })

  it('acknowledges /orca at once and refuses anyone but the owner', async () => {
    const { deps, handle } = harness()
    const slash = (user: string) => ({
      envelopeId: 'e2',
      type: 'slash_commands',
      payload: { command: '/orca', text: 'orca fix login', user_id: user }
    })
    expect(await handle(slash('USOMEONE'))).toEqual({
      text: 'Only the owner of this Orca+ can start work from Slack.'
    })
    expect(await handle(slash('UOWNER'))).toMatchObject({ text: expect.stringContaining('orca') })
    await vi.waitFor(() => expect(deps.startWork).toHaveBeenCalledTimes(1))
    expect(deps.startWork).toHaveBeenCalledWith({ repo: 'orca', agent: null, task: 'fix login' })
  })
})

describe('Slack text helpers', () => {
  it('unwraps links, mentions and entities', () => {
    expect(slackTextToPlain('see <https://x.dev/a|x.dev> and <@U1|gleb> &amp; <#C1|general>')).toBe(
      'see https://x.dev/a and gleb & general'
    )
  })

  it('reads an agent word only when it names an agent', () => {
    expect(parseStartCommand('orca claude fix it', isAgent)).toEqual({
      repo: 'orca',
      agent: 'claude',
      task: 'fix it'
    })
    expect(parseStartCommand('orca fix it', isAgent)).toEqual({
      repo: 'orca',
      agent: null,
      task: 'fix it'
    })
    expect(parseStartCommand('orca', isAgent)).toBeNull()
    expect(parseStartCommand('`id:r1` fix it', isAgent)).toEqual({
      repo: 'id:r1',
      agent: null,
      task: 'fix it'
    })
  })
})
