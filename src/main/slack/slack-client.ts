import type {
  SlackConnectInput,
  SlackConnectResult,
  SlackConnectionStatus,
  SlackMutationResult,
  SlackPerson,
  SlackTarget
} from '../../shared/slack-types'
import {
  clearStoredSlackCredential,
  getSlackCredentialError,
  getStoredSlackMetadata,
  hasStoredSlackCredential,
  loadStoredSlackTokens,
  saveSlackCredential,
  setSlackCredentialError,
  writeSlackMetadata,
  type SlackStoredMetadata,
  type SlackTokens
} from './slack-credential-store'
import { asSlackRecord, isSlackAuthError, SlackApiError, slackRequest } from './slack-request'

export type SlackSession = { tokens: SlackTokens; metadata: SlackStoredMetadata }

const MEMBER_ID_PATTERN = /^[UW][A-Z0-9]{6,}$/
const CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{6,}$/

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function getSlackStatus(): SlackConnectionStatus {
  const metadata = hasStoredSlackCredential() ? getStoredSlackMetadata() : null
  const credentialError = getSlackCredentialError()
  return {
    connected: metadata !== null,
    teamName: metadata?.teamName ?? null,
    bot: metadata?.bot ?? null,
    owner: metadata?.owner ?? null,
    target: metadata?.target ?? { kind: 'dm' },
    ...(credentialError ? { credentialError } : {})
  }
}

async function readOwner(botToken: string, ownerId: string): Promise<SlackPerson> {
  const user = asSlackRecord((await slackRequest(botToken, 'users.info', { user: ownerId })).user)
  if (user.is_bot === true || user.deleted === true) {
    throw new SlackApiError(
      'owner_not_a_person',
      'That member ID belongs to a bot or a deactivated user.'
    )
  }
  const profile = asSlackRecord(user.profile)
  return {
    id: ownerId,
    name:
      asString(profile.display_name) ??
      asString(profile.real_name) ??
      asString(user.real_name) ??
      asString(user.name) ??
      ownerId
  }
}

export async function connectSlack(input: SlackConnectInput): Promise<SlackConnectResult> {
  const botToken = input.botToken.trim()
  const appToken = input.appToken.trim()
  const ownerId = input.ownerId.trim().toUpperCase()
  if (!botToken.startsWith('xoxb-')) {
    return { ok: false, error: 'The bot token starts with xoxb- (OAuth & Permissions page).' }
  }
  if (!appToken.startsWith('xapp-')) {
    return {
      ok: false,
      error: 'The app token starts with xapp- (Basic Information → App-Level Tokens).'
    }
  }
  if (!MEMBER_ID_PATTERN.test(ownerId)) {
    return {
      ok: false,
      error: 'A Slack member ID looks like U0123ABCD (Profile → ⋮ → Copy member ID).'
    }
  }
  try {
    const auth = await slackRequest(botToken, 'auth.test')
    const teamId = asString(auth.team_id)
    const botId = asString(auth.user_id)
    if (!teamId || !botId) {
      throw new SlackApiError('unexpected_auth_test', 'Slack did not describe the bot token.')
    }
    const owner = await readOwner(botToken, ownerId)
    // Why: proves the app token can open Socket Mode before we save it; the URL is not used.
    await slackRequest(appToken, 'apps.connections.open')
    const dm = asSlackRecord(
      (await slackRequest(botToken, 'conversations.open', { users: ownerId })).channel
    )
    const dmChannelId = asString(dm.id)
    if (!dmChannelId) {
      throw new SlackApiError('unexpected_conversations_open', 'Slack did not open a DM with you.')
    }
    const previous = getStoredSlackMetadata()
    saveSlackCredential(
      { botToken, appToken },
      {
        version: 1,
        teamId,
        teamName: asString(auth.team) ?? teamId,
        bot: { id: botId, name: asString(auth.user) ?? botId },
        owner,
        dmChannelId,
        // Why: a token swap inside the same workspace keeps the channel the user picked.
        target: previous?.teamId === teamId ? previous.target : { kind: 'dm' },
        updatedAt: new Date().toISOString()
      }
    )
    return { ok: true, owner }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Could not connect to Slack.') }
  }
}

export function disconnectSlack(): void {
  clearStoredSlackCredential()
}

/** Runs one authenticated operation and records a rejected token for the status card. */
export async function withSlackSession<T>(run: (session: SlackSession) => Promise<T>): Promise<T> {
  const metadata = getStoredSlackMetadata()
  const tokens = loadStoredSlackTokens()
  if (!metadata || !tokens) {
    throw new SlackApiError('not_connected', 'Not connected to Slack.')
  }
  try {
    const result = await run({ tokens, metadata })
    setSlackCredentialError(null)
    return result
  } catch (error) {
    if (isSlackAuthError(error)) {
      setSlackCredentialError(errorMessage(error, 'Slack rejected the token.'))
    }
    throw error
  }
}

export function slackTargetChannelId(metadata: SlackStoredMetadata): string {
  return metadata.target.kind === 'channel' ? metadata.target.channelId : metadata.dmChannelId
}

export async function sendSlackTestMessage(): Promise<SlackMutationResult> {
  try {
    await withSlackSession(({ tokens, metadata }) =>
      slackRequest(tokens.botToken, 'chat.postMessage', {
        channel: slackTargetChannelId(metadata),
        text: 'Orca+ is connected. Agent updates will arrive here.'
      })
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Could not reach Slack.') }
  }
}

/** Accepts a channel ID or a copied channel link (…/archives/C0123ABCD). */
export function parseSlackChannelReference(value: string): string | null {
  const trimmed = value.trim()
  const fromLink = /\/archives\/([CG][A-Z0-9]+)/.exec(trimmed)?.[1]
  const candidate = (fromLink ?? trimmed).toUpperCase()
  return CHANNEL_ID_PATTERN.test(candidate) ? candidate : null
}

export async function setSlackTarget(
  input: { kind: 'dm' } | { kind: 'channel'; channel: string }
): Promise<SlackMutationResult> {
  try {
    const target = await withSlackSession(async ({ tokens }): Promise<SlackTarget> => {
      if (input.kind === 'dm') {
        return { kind: 'dm' }
      }
      const channelId = parseSlackChannelReference(input.channel)
      if (!channelId) {
        throw new SlackApiError('bad_channel', 'Paste a channel ID (C0123ABCD) or a channel link.')
      }
      const channel = asSlackRecord(
        (await slackRequest(tokens.botToken, 'conversations.info', { channel: channelId })).channel
      )
      if (channel.is_member !== true) {
        throw new SlackApiError('not_in_channel')
      }
      return { kind: 'channel', channelId, channelName: asString(channel.name) ?? channelId }
    })
    const metadata = getStoredSlackMetadata()
    if (metadata) {
      writeSlackMetadata({ ...metadata, target, updatedAt: new Date().toISOString() })
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Could not change where Slack messages go.') }
  }
}
