// Custom build (outgoing-approval-target): a Slack channel or member id as the owner knows it — `#name`,
// `DM with Name` — asked of the Orca+ bot. A private channel the bot is not in, or someone else's DM,
// stays unnamed here; the caller falls back to what the Slack scout recorded.
import { withSlackSession } from '../../slack/slack-client'
import { asSlackRecord, slackRequest } from '../../slack/slack-request'

const SLACK_ID = /^[CGDUW][A-Z0-9]{6,}$/
const named = new Map<string, string>()

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function personName(token: string, userId: string): Promise<string | null> {
  const user = asSlackRecord((await slackRequest(token, 'users.info', { user: userId })).user)
  const profile = asSlackRecord(user.profile)
  return (
    text(profile.real_name) ?? text(profile.display_name) ?? text(user.real_name) ?? text(user.name)
  )
}

async function lookUp(token: string, id: string): Promise<string | null> {
  if (id.startsWith('U') || id.startsWith('W')) {
    const name = await personName(token, id)
    return name ? `DM with ${name}` : null
  }
  const channel = asSlackRecord(
    (await slackRequest(token, 'conversations.info', { channel: id })).channel
  )
  if (channel.is_im === true) {
    const user = text(channel.user)
    const name = user ? await personName(token, user) : null
    return name ? `DM with ${name}` : 'a direct message'
  }
  if (channel.is_mpim === true) {
    return 'a group DM'
  }
  const name = text(channel.name)
  return name ? `#${name}` : null
}

/** Null when Slack is not connected, cannot see the conversation, or does not answer in time. */
export async function slackConversationName(id: string, timeoutMs = 2_500): Promise<string | null> {
  if (!SLACK_ID.test(id)) {
    return null
  }
  const known = named.get(id)
  if (known) {
    return known
  }
  const lookup = withSlackSession(({ tokens }) => lookUp(tokens.botToken, id)).catch(() => null)
  const timeout = new Promise<null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    timer.unref?.()
  })
  const name = await Promise.race([lookup, timeout])
  if (name) {
    named.set(id, name)
  }
  return name
}
