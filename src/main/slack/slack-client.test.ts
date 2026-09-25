import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SlackRequestModule from './slack-request'

const { requestMock, profileDir } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  profileDir: { path: '' }
}))

vi.mock('./slack-request', async (importOriginal) => ({
  ...(await importOriginal<typeof SlackRequestModule>()),
  slackRequest: requestMock
}))

vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => profileDir.path
}))

import { SlackApiError } from './slack-request'
import { _resetSlackCredentialCache } from './slack-credential-store'
import {
  connectSlack,
  getSlackStatus,
  parseSlackChannelReference,
  sendSlackTestMessage,
  setSlackTarget
} from './slack-client'

const VALID = { botToken: 'xoxb-1', appToken: 'xapp-1', ownerId: 'u0123abcd' }

function answerSlack(overrides: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  requestMock.mockImplementation(
    async (_token: string, method: string, args: Record<string, unknown> = {}) => {
      const override = overrides[method]
      if (override) {
        return override(args)
      }
      switch (method) {
        case 'auth.test':
          return { ok: true, team_id: 'T1', team: 'Lev', user_id: 'UBOT1', user: 'orca-plus' }
        case 'users.info':
          return { ok: true, user: { name: 'gleb', profile: { display_name: 'Gleb' } } }
        case 'apps.connections.open':
          return { ok: true, url: 'wss://example' }
        case 'conversations.open':
          return { ok: true, channel: { id: 'D1' } }
        case 'conversations.info':
          return { ok: true, channel: { name: 'agents', is_member: true } }
        default:
          return { ok: true }
      }
    }
  )
}

beforeEach(() => {
  profileDir.path = mkdtempSync(join(tmpdir(), 'slack-client-'))
  _resetSlackCredentialCache()
  requestMock.mockReset()
  answerSlack()
})

afterEach(() => {
  rmSync(profileDir.path, { recursive: true, force: true })
})

describe('connectSlack', () => {
  it('refuses swapped or malformed inputs before calling Slack', async () => {
    expect(await connectSlack({ ...VALID, botToken: 'xapp-1' })).toMatchObject({ ok: false })
    expect(await connectSlack({ ...VALID, appToken: 'xoxb-1' })).toMatchObject({ ok: false })
    expect(await connectSlack({ ...VALID, ownerId: 'gleb' })).toMatchObject({ ok: false })
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('verifies both tokens, opens the owner DM and persists across a cache reset', async () => {
    expect(await connectSlack(VALID)).toEqual({
      ok: true,
      owner: { id: 'U0123ABCD', name: 'Gleb' }
    })
    const calls = requestMock.mock.calls.map(([token, method]) => `${token} ${method}`)
    expect(calls).toEqual([
      'xoxb-1 auth.test',
      'xoxb-1 users.info',
      'xapp-1 apps.connections.open',
      'xoxb-1 conversations.open'
    ])
    _resetSlackCredentialCache()
    expect(getSlackStatus()).toEqual({
      connected: true,
      teamName: 'Lev',
      bot: { id: 'UBOT1', name: 'orca-plus' },
      owner: { id: 'U0123ABCD', name: 'Gleb' },
      target: { kind: 'dm' }
    })
  })

  it('refuses a bot as the owner', async () => {
    answerSlack({ 'users.info': () => ({ ok: true, user: { is_bot: true } }) })
    expect(await connectSlack(VALID)).toMatchObject({ ok: false })
    expect(getSlackStatus().connected).toBe(false)
  })

  it('keeps the chosen channel when tokens are replaced in the same workspace', async () => {
    await connectSlack(VALID)
    expect(await setSlackTarget({ kind: 'channel', channel: 'C0AGENTS1' })).toEqual({ ok: true })
    await connectSlack({ ...VALID, botToken: 'xoxb-2' })
    expect(getSlackStatus().target).toEqual({
      kind: 'channel',
      channelId: 'C0AGENTS1',
      channelName: 'agents'
    })
  })
})

describe('setSlackTarget', () => {
  it('refuses a channel the bot was not invited to', async () => {
    await connectSlack(VALID)
    answerSlack({ 'conversations.info': () => ({ ok: true, channel: { is_member: false } }) })
    const result = await setSlackTarget({ kind: 'channel', channel: 'C0AGENTS1' })
    expect(result).toMatchObject({ ok: false })
    expect(getSlackStatus().target).toEqual({ kind: 'dm' })
  })
})

describe('sendSlackTestMessage', () => {
  it('posts to the DM, then to the chosen channel', async () => {
    await connectSlack(VALID)
    await sendSlackTestMessage()
    await setSlackTarget({ kind: 'channel', channel: 'https://lev.slack.com/archives/C0AGENTS1' })
    await sendSlackTestMessage()
    const channels = requestMock.mock.calls
      .filter(([, method]) => method === 'chat.postMessage')
      .map(([, , args]) => args.channel)
    expect(channels).toEqual(['D1', 'C0AGENTS1'])
  })

  it('flags a revoked token on the status card', async () => {
    await connectSlack(VALID)
    answerSlack({
      'chat.postMessage': () => {
        throw new SlackApiError('token_revoked')
      }
    })
    expect(await sendSlackTestMessage()).toMatchObject({ ok: false })
    expect(getSlackStatus().credentialError).toMatch(/rejected the token/)
  })
})

describe('parseSlackChannelReference', () => {
  it('reads IDs and copied links, and nothing else', () => {
    expect(parseSlackChannelReference(' c0agents1 ')).toBe('C0AGENTS1')
    expect(parseSlackChannelReference('https://x.slack.com/archives/G0PRIV123/p1')).toBe(
      'G0PRIV123'
    )
    expect(parseSlackChannelReference('#general')).toBeNull()
  })
})
