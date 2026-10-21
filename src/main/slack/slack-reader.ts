// Custom build (slack-reply-reader): connects the owner's user token and runs the reads made with it.
import type { SlackReaderConnectResult, SlackReaderStatus } from '../../shared/slack-types'
import {
  clearSlackReaderToken,
  getSlackReaderMetadata,
  hasSlackReaderToken,
  loadSlackReaderToken,
  saveSlackReaderToken
} from './slack-reader-token-store'
import { SLACK_READER_SCOPES } from '../../shared/slack-app-manifest'
import {
  asSlackRecord,
  describeSlackError,
  isSlackAuthError,
  SlackApiError,
  slackRequest
} from './slack-request'
import { getStoredSlackMetadata } from './slack-credential-store'

let readerError: string | null = null

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function errorText(error: unknown): string {
  if (error instanceof SlackApiError && error.code === 'missing_scope') {
    return `The user token lacks a permission. Add ${SLACK_READER_SCOPES.join(', ')} under User Token Scopes, reinstall the app and paste the new token.`
  }
  if (error instanceof SlackApiError) {
    return error.message || describeSlackError(error.code)
  }
  return error instanceof Error ? error.message : 'Could not reach Slack.'
}

export async function connectSlackReader(rawToken: string): Promise<SlackReaderConnectResult> {
  const token = rawToken.trim()
  if (!token.startsWith('xoxp-')) {
    return {
      ok: false,
      error: 'The user token starts with xoxp- (OAuth & Permissions → User OAuth Token).'
    }
  }
  try {
    const auth = await slackRequest(token, 'auth.test')
    const teamId = asString(auth.team_id)
    const userId = asString(auth.user_id)
    if (!teamId || !userId) {
      throw new SlackApiError('unexpected_auth_test', 'Slack did not describe the user token.')
    }
    // Why: someone else's token would hand their private DMs to the owner's chats.
    const connected = getStoredSlackMetadata()
    if (connected && (connected.teamId !== teamId || connected.owner.id !== userId)) {
      return {
        ok: false,
        error: `This token belongs to ${asString(auth.user) ?? userId} in ${asString(auth.team) ?? teamId}; paste the token of ${connected.owner.name} in ${connected.teamName}.`
      }
    }
    // Why: proves the history scopes before saving — a token without them would fail silently later.
    const dms = await slackRequest(token, 'conversations.list', { types: 'im', limit: 1 })
    const firstDm = Array.isArray(dms.channels) ? asString(asSlackRecord(dms.channels[0]).id) : null
    if (firstDm) {
      await slackRequest(token, 'conversations.history', { channel: firstDm, limit: 1 })
    }
    // Why: the 👾 marks are read with reactions.list; without the scope no To work card comes.
    await slackRequest(token, 'reactions.list', { limit: 1 })
    const metadata = {
      teamId,
      teamName: asString(auth.team) ?? teamId,
      user: { id: userId, name: asString(auth.user) ?? userId },
      updatedAt: new Date().toISOString()
    }
    saveSlackReaderToken(token, metadata)
    readerError = null
    return { ok: true, user: metadata.user }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

export function disconnectSlackReader(): void {
  clearSlackReaderToken()
  readerError = null
}

export function getSlackReaderStatus(): SlackReaderStatus {
  const metadata = getSlackReaderMetadata()
  return {
    connected: hasSlackReaderToken(),
    user: metadata?.user ?? null,
    ...(readerError ? { error: readerError } : {})
  }
}

/** Null when no token is saved; a rejected token is recorded for the Settings card. */
export async function withSlackReader<T>(
  run: (token: string, owner: string) => Promise<T>
): Promise<T | null> {
  const metadata = getSlackReaderMetadata()
  let token: string | null = null
  try {
    token = hasSlackReaderToken() ? loadSlackReaderToken() : null
  } catch (error) {
    // Why: a token the keychain can no longer decrypt looks saved but fails every read.
    readerError = 'The saved user token can no longer be read. Paste it again.'
    throw error
  }
  if (!metadata || !token) {
    return null
  }
  try {
    const result = await run(token, metadata.user.id)
    readerError = null
    return result
  } catch (error) {
    if (
      isSlackAuthError(error) ||
      (error instanceof SlackApiError && error.code === 'missing_scope')
    ) {
      readerError = errorText(error)
    }
    throw error
  }
}
