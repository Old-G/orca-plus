import { describe, expect, it, vi } from 'vitest'
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'
import { createSlackAgentNotifier, type SlackAgentNotifierDeps } from './slack-agent-notifier'
import type { SlackSession } from './slack-client'
import { SlackApiError } from './slack-request'
import type { SlackThreadStore } from './slack-thread-store'

const session: SlackSession = {
  tokens: { botToken: 'xoxb-1', appToken: 'xapp-1' },
  metadata: {
    version: 1,
    teamId: 'T1',
    teamName: 'Lev',
    bot: { id: 'UBOT', name: 'orca-plus' },
    owner: { id: 'U1', name: 'Gleb' },
    dmChannelId: 'D1',
    target: { kind: 'dm' },
    updatedAt: ''
  }
}

function memoryThreads(): SlackThreadStore {
  const map = new Map<string, string>()
  return {
    get: (channel, worktree) => map.get(`${channel}/${worktree}`) ?? null,
    set: (channel, worktree, ts) => void map.set(`${channel}/${worktree}`, ts),
    forget: (channel, worktree) => void map.delete(`${channel}/${worktree}`)
  }
}

function harness(overrides: Partial<SlackAgentNotifierDeps> = {}) {
  let parents = 0
  const request = vi.fn(async (_token: string, _method: string, args: Record<string, unknown>) => {
    if (args.thread_ts === undefined) {
      parents += 1
      return { ok: true, ts: `parent-${parents}` }
    }
    return { ok: true, ts: 'reply' }
  })
  const deps: SlackAgentNotifierDeps = {
    isConnected: () => true,
    withSession: (run) => run(session),
    request,
    threads: memoryThreads(),
    readLinkedItem: () => ({ label: 'DEV-1 Login', url: 'https://app.clickup.com/t/1' }),
    readGitSummary: async () => null,
    ...overrides
  }
  return { notifier: createSlackAgentNotifier(deps), request }
}

const done = (id: string): NotificationDispatchRequest => ({
  source: 'agent-task-complete',
  worktreeId: 'wt-1',
  worktreeLabel: 'fix-login',
  repoLabel: 'orca',
  agentType: 'claude',
  agentState: 'done',
  notificationId: id
})

describe('createSlackAgentNotifier', () => {
  it('opens one thread per workspace and replies in it, even for concurrent updates', async () => {
    const { notifier, request } = harness()
    await Promise.all([notifier.notify(done('a')), notifier.notify(done('b'))])
    await notifier.notify(done('c'))
    const calls = request.mock.calls.map(([, , args]) => args)
    expect(calls.filter((args) => args.thread_ts === undefined)).toHaveLength(1)
    expect(calls.filter((args) => args.thread_ts === 'parent-1')).toHaveLength(3)
    expect(JSON.stringify(calls[0].blocks)).toContain('<https://app.clickup.com/t/1|DEV-1 Login>')
    expect(calls.every((args) => args.channel === 'D1')).toBe(true)
  })

  it('posts a fresh parent when the old thread was deleted', async () => {
    const { notifier, request } = harness()
    await notifier.notify(done('a'))
    request.mockImplementationOnce(async () => {
      throw new SlackApiError('thread_not_found')
    })
    await notifier.notify(done('b'))
    const threadTs = request.mock.calls.map(([, , args]) => args.thread_ts)
    expect(threadTs).toEqual([undefined, 'parent-1', 'parent-1', undefined, 'parent-2'])
  })

  it('drops repeats, working states and updates while disconnected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { notifier, request } = harness()
    await notifier.notify(done('a'))
    await notifier.notify(done('a'))
    await notifier.notify({ ...done('w'), agentState: 'working' })
    expect(request).toHaveBeenCalledTimes(2)
    const offline = harness({
      withSession: async () => {
        throw new SlackApiError('not_connected', 'Not connected to Slack.')
      }
    })
    await offline.notifier.notify(done('x'))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('leaves the git line out when the execution host cannot answer', async () => {
    const { notifier, request } = harness({
      readGitSummary: async () => {
        throw new Error('ssh provider unavailable')
      }
    })
    await notifier.notify(done('a'))
    const reply = request.mock.calls[1][2]
    expect(JSON.stringify(reply.blocks)).not.toContain('changed')
    expect(reply.text).toBe('Claude finished · orca / fix-login')
  })
})
