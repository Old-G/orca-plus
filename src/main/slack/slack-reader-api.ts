// Custom build (slack-reply-reader): the few Slack reads the answer watch makes with the owner's
// token, shaped for it; DM channels and names are cached across passes.
import type { SlackReadApi, SlackReadMessage } from '../hq-today/hq-slack-waiting-replies'
import { asSlackRecord, slackRequest } from './slack-request'

// Why: a new DM appears rarely; one list per half hour keeps the watch to a call per thread.
const DM_LIST_TTL_MS = 30 * 60_000
const DM_LIST_PAGES = 5

export type SlackReaderCache = {
  dms: Map<string, string>
  dmsAt: number
  names: Map<string, string>
}

export function createSlackReaderCache(): SlackReaderCache {
  return { dms: new Map(), dmsAt: 0, names: new Map() }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readMessage(value: unknown): SlackReadMessage | null {
  const raw = asSlackRecord(value)
  const ts = asString(raw.ts)
  const subtype = asString(raw.subtype)
  // Why: joins, edits and other system lines are not anyone's answer.
  if (!ts || (subtype && !['thread_broadcast', 'file_share', 'me_message'].includes(subtype))) {
    return null
  }
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .map((file) => asString(asSlackRecord(file).name))
    .filter((name): name is string => name !== null)
    .map((name) => `[file: ${name}]`)
  return {
    ts,
    user: asString(raw.user),
    text: [asString(raw.text) ?? '', ...files].filter(Boolean).join(' '),
    threadTs: asString(raw.thread_ts),
    bot: Boolean(raw.bot_id) || subtype === 'bot_message'
  }
}

function readMessages(body: Record<string, unknown>): SlackReadMessage[] {
  const list = Array.isArray(body.messages) ? body.messages : []
  return list.map(readMessage).filter((message): message is SlackReadMessage => message !== null)
}

async function refreshDms(token: string, cache: SlackReaderCache, now: number): Promise<void> {
  const dms = new Map<string, string>()
  let cursor: string | null = null
  for (let page = 0; page < DM_LIST_PAGES; page += 1) {
    const body = await slackRequest(token, 'conversations.list', {
      types: 'im',
      limit: 1000,
      ...(cursor ? { cursor } : {})
    })
    for (const channel of Array.isArray(body.channels) ? body.channels : []) {
      const raw = asSlackRecord(channel)
      const id = asString(raw.id)
      const user = asString(raw.user)
      if (id && user) {
        dms.set(user, id)
      }
    }
    cursor = asString(asSlackRecord(body.response_metadata).next_cursor)
    if (!cursor) {
      break
    }
  }
  cache.dms = dms
  cache.dmsAt = now
}

export function createSlackReadApi(
  token: string,
  owner: string,
  cache: SlackReaderCache,
  now: () => number = Date.now
): SlackReadApi {
  return {
    owner,
    history: async (channel, oldest) =>
      readMessages(
        await slackRequest(token, 'conversations.history', {
          channel,
          oldest,
          inclusive: false,
          limit: 100
        })
      ),
    replies: async (channel, threadTs, oldest) =>
      readMessages(
        await slackRequest(token, 'conversations.replies', {
          channel,
          ts: threadTs,
          oldest,
          limit: 200
        })
      ),
    dmChannel: async (userId) => {
      if (now() - cache.dmsAt > DM_LIST_TTL_MS) {
        await refreshDms(token, cache, now())
      }
      return cache.dms.get(userId) ?? null
    },
    userName: async (userId) => {
      const known = cache.names.get(userId)
      if (known) {
        return known
      }
      let name = userId
      try {
        const user = asSlackRecord((await slackRequest(token, 'users.info', { user: userId })).user)
        const profile = asSlackRecord(user.profile)
        name =
          asString(profile.display_name) ??
          asString(profile.real_name) ??
          asString(user.real_name) ??
          asString(user.name) ??
          userId
      } catch (error) {
        console.warn(`[slack-reader] naming ${userId} failed:`, error)
      }
      cache.names.set(userId, name)
      return name
    }
  }
}
