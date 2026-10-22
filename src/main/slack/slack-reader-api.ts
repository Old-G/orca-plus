// Custom build (slack-reply-reader): the few Slack reads the answer watch makes with the owner's
// token, shaped for it; DM channels and names are cached across passes.
import type { SlackReadApi, SlackReadMessage } from '../hq-today/hq-slack-waiting-replies'
import type { HqIntakeReadApi } from '../hq-today/hq-slack-intake'
import type { HqIntakeDraft } from '../hq-today/hq-slack-intake-suggest'
import { HQ_INTAKE_EMOJI, HQ_INTAKE_TEXT_MAX } from '../../shared/hq-slack-intake'
import { plainSlackText } from '../hq-today/hq-slack-waiting-replies'
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
    bot: Boolean(raw.bot_id) || subtype === 'bot_message',
    latestReply: asString(raw.latest_reply)
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
    },
    permalink: async (channel, ts) =>
      asString(
        (await slackRequest(token, 'chat.getPermalink', { channel, message_ts: ts })).permalink
      )
  }
}

/** Links in Slack's markup, before it is flattened for reading. */
export function slackTextLinks(text: string): string[] {
  const links = new Set<string>()
  for (const match of text.matchAll(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g)) {
    links.add(match[1])
  }
  return [...links]
}

// Why: reactions.list carries no permalink; a link built from the workspace URL costs no call.
const workspaceUrls = new Map<string, string | null>()
const REACTION_PAGES = 5

async function workspaceUrl(token: string): Promise<string | null> {
  if (!workspaceUrls.has(token)) {
    workspaceUrls.set(token, asString((await slackRequest(token, 'auth.test')).url))
  }
  return workspaceUrls.get(token) ?? null
}

/** Slack's message link: `<workspace>/archives/<channel>/p<ts>`, with the thread for a reply. */
export function slackMessageUrl(
  base: string,
  channel: string,
  ts: string,
  threadTs: string | null
): string {
  const link = `${base.replace(/\/?$/, '/')}archives/${channel}/p${ts.replace('.', '')}`
  return threadTs && threadTs !== ts ? `${link}?thread_ts=${threadTs}&cid=${channel}` : link
}

function slackVenue(channel: string): HqIntakeDraft['venue'] {
  return channel.startsWith('D') ? 'dm' : channel.startsWith('G') ? 'group' : 'channel'
}

const MENTION_PAGE = 50

/** Custom build (hq-slack-intake): the owner's 👾-marked messages, newest first. */
export function createSlackIntakeApi(
  token: string,
  owner: string,
  name: (userId: string) => Promise<string>
): HqIntakeReadApi {
  return {
    marked: async () => {
      // Why every page: a mark missing from a partial read would close its card.
      const entries: unknown[] = []
      let cursor: string | null = null
      for (let page = 0; page < REACTION_PAGES; page += 1) {
        const body = await slackRequest(token, 'reactions.list', {
          full: true,
          limit: 100,
          ...(cursor ? { cursor } : {})
        })
        entries.push(...(Array.isArray(body.items) ? body.items : []))
        cursor = asString(asSlackRecord(body.response_metadata).next_cursor)
        if (!cursor) {
          break
        }
      }
      const base = await workspaceUrl(token).catch(() => null)
      const drafts: HqIntakeDraft[] = []
      for (const entry of entries) {
        const item = asSlackRecord(entry)
        const channel = asString(item.channel)
        const message = asSlackRecord(item.message)
        const ts = asString(message.ts)
        const reactions = Array.isArray(message.reactions) ? message.reactions : []
        const marked = reactions.some((reaction) => {
          const raw = asSlackRecord(reaction)
          return (
            raw.name === HQ_INTAKE_EMOJI && Array.isArray(raw.users) && raw.users.includes(owner)
          )
        })
        if (item.type !== 'message' || !channel || !ts || !marked) {
          continue
        }
        const raw = asString(message.text) ?? ''
        const user = asString(message.user)
        const files = (Array.isArray(message.files) ? message.files : [])
          .map((file) => asString(asSlackRecord(file).name))
          .filter((fileName): fileName is string => fileName !== null)
        drafts.push({
          channel,
          ts,
          threadTs: asString(message.thread_ts),
          author: user ? await name(user) : (asString(message.username) ?? 'Someone'),
          authorSlackId: user,
          venue: slackVenue(channel),
          text: plainSlackText(raw).slice(0, HQ_INTAKE_TEXT_MAX),
          links: slackTextLinks(raw),
          files,
          permalink:
            asString(message.permalink) ??
            (base ? slackMessageUrl(base, channel, ts, asString(message.thread_ts)) : null),
          at: Math.round(Number(ts) * 1000)
        })
      }
      return drafts
    },
    // Custom build (hq-slack-mentions): people's messages that @mention the owner, newest first.
    mentioned: async (since) => {
      const body = await slackRequest(token, 'search.messages', {
        query: `<@${owner}>`,
        sort: 'timestamp',
        sort_dir: 'desc',
        count: MENTION_PAGE
      })
      const matches = asSlackRecord(body.messages).matches
      const drafts: HqIntakeDraft[] = []
      for (const entry of Array.isArray(matches) ? matches : []) {
        const match = asSlackRecord(entry)
        const channel = asString(asSlackRecord(match.channel).id)
        const ts = asString(match.ts)
        const user = asString(match.user)
        const at = Math.round(Number(ts) * 1000)
        // Why: bots and the owner's own messages (his agents post as him) are not requests to him.
        if (!channel || !ts || !user || user === owner || at < since) {
          continue
        }
        const raw = asString(match.text) ?? ''
        const permalink = asString(match.permalink)
        drafts.push({
          channel,
          ts,
          threadTs: permalink ? new URL(permalink).searchParams.get('thread_ts') : null,
          author: await name(user),
          authorSlackId: user,
          venue: slackVenue(channel),
          text: plainSlackText(raw).slice(0, HQ_INTAKE_TEXT_MAX),
          links: slackTextLinks(raw),
          files: (Array.isArray(match.files) ? match.files : [])
            .map((file) => asString(asSlackRecord(file).name))
            .filter((fileName): fileName is string => fileName !== null),
          permalink,
          at,
          via: 'mention'
        })
      }
      return drafts
    }
  }
}
