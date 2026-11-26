// Custom build (hq-router, plan router T1, owner 26.11): the 👾 router wired to Orca+ — open chats from
// the journal, crumbs and bound threads from Orca+'s records, Jev with the key from Orca+'s environment
// (or the env file the settings name), the small Claude model as the fallback.
import { readFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import {
  HQ_INTAKE_KIND,
  hqIntakeBellItem,
  hqIntakePrompt,
  type HqIntake
} from '../../shared/hq-slack-intake'
import type { HqRoute, HqRouterChat } from '../../shared/hq-router'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { withSlackReader } from '../slack/slack-reader'
import {
  createSlackReadApi,
  slackTextLinks,
  type SlackReaderCache
} from '../slack/slack-reader-api'
import { createSlackLedgerApi } from '../slack/slack-ledger-api'
import {
  HQ_ROUTER_FALLBACK_MODEL,
  hqRouterJevCall,
  hqRouterKey,
  hqRouterMarkLine,
  routeHqIntake
} from './hq-router'
import type { HqSlackIntakeDeps } from './hq-slack-intake'
import { hqIntakeFallbackSummary, type HqIntakeDraft } from './hq-slack-intake-suggest'
import { generateHqText } from './hq-task-questions'
import { getLogsDirectory } from '../observability/logs-directory'

/** Why a month: a chat left open a week is still where its thread's answer belongs (as the ledger). */
const CHATS_WINDOW_MS = 30 * 24 * 60 * 60_000
const REPORTS_PER_CHAT = 2

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

const ROLES = new Set(['lead', 'sublead', 'worker', 'review'])

export function hqRouterChats(runtime: OrcaRuntimeService, now: number): HqRouterChat[] {
  const since = now - CHATS_WINDOW_MS
  const reports = new Map<string, string[]>()
  for (const entry of runtime.pulseListJournal({ kind: 'chat.report', since, limit: 300 })) {
    const held = entry.sessionId ? (reports.get(entry.sessionId) ?? []) : null
    if (entry.sessionId && held && held.length < REPORTS_PER_CHAT) {
      reports.set(entry.sessionId, [...held, entry.title])
    }
  }
  const router = runtime.pulseRouter()
  const open = runtime.pulseListRecentSessions(since).filter(
    (session) =>
      session.closedAt === null &&
      session.state !== 'closed' &&
      // Why: a chat that handed off sends its messages on; its successor is the one to offer.
      runtime.pulseLiveSessionOf(session.sessionId) === session.sessionId
  )
  const ids = new Set(open.map((session) => session.sessionId))
  return open.map((session) => {
    const role = router.roleOf(session.sessionId)
    const lead = router.leadOf(session.sessionId)
    return {
      sessionId: session.sessionId,
      title:
        runtime.openedAgentSessionRecordStore()?.getRecord(session.sessionId)?.conversationName ||
        session.address ||
        session.sessionId,
      project: session.project,
      repoId: session.worktreeId?.split('::')[0] || null,
      role: role && ROLES.has(role) ? (role as HqRouterChat['role']) : null,
      leadId: lead && ids.has(lead) && lead !== session.sessionId ? lead : null,
      taskRef: session.taskRef,
      lastReport: reports.get(session.sessionId)?.join(' / ') ?? null,
      waitsOnAuthor: [],
      lastActivityAt: session.lastActivityAt
    }
  })
}

/** The router log's key for a card: the marked message. */
export function hqRouterLogKey(message: { channel: string; ts: string }): string {
  return `slack:${message.channel}:${message.ts}`
}

// Why (T1c, 26.11): a mark that came to nothing left no word anywhere; main's console reaches no file.
function writeMarkLog(line: string): void {
  const dir = getLogsDirectory()
  void mkdir(dir, { recursive: true })
    .then(() => appendFile(join(dir, 'hq-router.log'), line))
    .catch((error: unknown) => console.warn('[hq-router] mark log not written', error))
}

/** The router's part of the 👾 watch; empty while the router is off. */
export function hqRouterIntakeDeps(
  store: Store,
  runtime: OrcaRuntimeService,
  cache: SlackReaderCache
): Pick<HqSlackIntakeDeps, 'route' | 'routerPreTrial' | 'autoSend' | 'settle' | 'noteMark'> {
  const on = (): boolean => (store.getSettings().hqRouter ?? 'trial') !== 'off'
  if (!on()) {
    return {}
  }
  const route = (draft: HqIntakeDraft): Promise<HqRoute | null> => {
    const settings = store.getSettings()
    if ((settings.hqRouter ?? 'trial') === 'off') {
      return Promise.resolve(null)
    }
    const key = hqRouterKey(process.env, settings.hqRouterKeyFile, readText)
    const router = runtime.pulseRouter()
    const routed = routeHqIntake(draft, {
      chats: () => hqRouterChats(runtime, Date.now()),
      binding: (lookup) => router.binding(lookup),
      leadOf: (sessionId) => router.leadOf(sessionId),
      crumb: (lookup) => router.crumb(lookup),
      boundChat: (conversationKey) => router.boundChat(conversationKey),
      history: (slackUserId) => router.authorHistory(slackUserId),
      thread: async (channel, threadTs) =>
        withSlackReader(async (token, owner) => {
          const names = createSlackReadApi(token, owner, cache)
          const api = createSlackLedgerApi(
            token,
            owner,
            async (userId) => names.userName(userId),
            (userId) => names.isBot(userId)
          )
          const messages = (await api.thread?.(channel, threadTs, channel.startsWith('D'))) ?? []
          return messages.map((message) => message.text)
        }),
      waitsOn: (slackUserId) => {
        const person = runtime.pulseListPeople().find((entry) => entry.slackUserId === slackUserId)
        const out = new Map<string, string[]>()
        if (!person) {
          return out
        }
        for (const waiting of runtime.pulseListWaitings({ status: 'open', direction: 'on-them' })) {
          if (waiting.personId === person.id && waiting.agentSessionId) {
            const chat = runtime.pulseLiveSessionOf(waiting.agentSessionId)
            out.set(chat, [...(out.get(chat) ?? []), waiting.title])
          }
        }
        return out
      },
      jev: key ? hqRouterJevCall(key) : null,
      fallback: async (prompt) => {
        const hqPath = store.getSettings().hqPath
        return hqPath
          ? generateHqText(
              prompt,
              {
                emptyResultName: 'router choice',
                operation: 'hq-slack-intake',
                model: HQ_ROUTER_FALLBACK_MODEL
              },
              {
                settings: store.getSettings(),
                cwd: hqPath,
                getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
              }
            )
          : { ok: false, error: 'No HQ folder is set.' }
      },
      crumbs: settings.hqRouterCrumbs !== false,
      now: Date.now
    })
    return routed.then((done) => {
      router.logRoute({
        key: hqRouterLogKey(draft),
        at: Date.now(),
        how: done.how,
        target: done.target,
        top: [done.target, ...done.alternatives.map((other) => other.sessionId)].slice(0, 3),
        auto: done.auto
      })
      return done
    })
  }
  return {
    route,
    noteMark: (key, outcome) => hqRouterMarkLine(key, outcome, writeMarkLog, Date.now()),
    routerPreTrial: (current) => {
      const settings = store.getSettings()
      if ((settings.hqRouter ?? 'trial') === 'off') {
        return null
      }
      if (Array.isArray(settings.hqRouterPreTrial)) {
        return new Set(settings.hqRouterPreTrial)
      }
      store.updateSettings({ hqRouterPreTrial: [...current] })
      return new Set(current)
    },
    // Why only a thread his own «Send» bound (owner 26.11): the trial sends nothing else by itself.
    autoSend: async (intake: HqIntake) =>
      intake.route?.auto === true && intake.route.target !== 'new'
        ? deliverToNativeChat(
            intake.route.target,
            hqIntakePrompt(intake, { projectName: intake.route.project, note: '' }),
            'hq-router'
          )
        : false,
    settle: (dedupeKey) => {
      const item = runtime
        .pulseListInbox(false, { kind: 'hq-intake' })
        .find((entry) => entry.dedupeKey === dedupeKey)
      if (item) {
        runtime.pulseMarkInboxDone(item.id, 'sent')
      }
    }
  }
}

const PERMALINK = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})(?:\?[^#\s]*?thread_ts=(\d+\.\d+))?/

/** Channel, message ts and thread root of a Slack message link; null for anything else. */
export function parseHqRouterLink(
  url: string
): { channel: string; ts: string; threadTs: string | null } | null {
  const match = PERMALINK.exec(url)
  return match
    ? { channel: match[1], ts: `${match[2]}.${match[3]}`, threadTs: match[4] ?? null }
    : null
}

/**
 * Custom build (hq-router): `hqRouter:routeLink` — the Slack message a pasted link points to, read with
 * the owner's token and routed like a 👾 mark; its card's key is `router:<channel>:<ts>`.
 */
export function registerHqRouterLink(
  store: Store,
  runtime: OrcaRuntimeService,
  cache: SlackReaderCache
): void {
  ipcMain.handle('hqRouter:routeLink', async (_event, url: unknown) => {
    const link = typeof url === 'string' ? parseHqRouterLink(url) : null
    if (!link) {
      return { ok: false, error: 'Not a Slack message link' }
    }
    const route = hqRouterIntakeDeps(store, runtime, cache).route
    const read = await withSlackReader(async (token, owner) => {
      const names = createSlackReadApi(token, owner, cache)
      const api = createSlackLedgerApi(
        token,
        owner,
        async (userId) => names.userName(userId),
        (userId) => names.isBot(userId)
      )
      const root = link.threadTs ?? link.ts
      const messages = (await api.thread?.(link.channel, root, link.channel.startsWith('D'))) ?? []
      const message = messages.find((entry) => entry.ts === link.ts)
      return message
        ? { message, author: message.user ? await names.userName(message.user) : null }
        : null
    }).catch(() => null)
    if (!read) {
      return { ok: false, error: 'The message could not be read' }
    }
    const { message } = read
    const draft: HqIntakeDraft = {
      channel: message.channel,
      ts: message.ts,
      threadTs: message.threadTs,
      author: read.author ?? 'Someone',
      authorSlackId: message.user,
      venue: message.dm ? (message.channel.startsWith('G') ? 'group' : 'dm') : 'channel',
      text: message.text,
      links: slackTextLinks(message.rawText),
      files: [],
      permalink: message.permalink,
      at: Math.round(Number(message.ts) * 1000)
    }
    const routed = route ? await route(draft).catch(() => null) : null
    const intake: HqIntake = {
      ...draft,
      // Why the paste time: the card lives a week from when he pasted it, not from the old message.
      at: Date.now(),
      pasted: true,
      repoId: routed?.repoId ?? null,
      project: routed?.project ?? null,
      summary: hqIntakeFallbackSummary(message.text),
      ...(routed ? { route: routed } : {})
    }
    runtime.pulseAddInboxItem({ ...hqIntakeBellItem(intake), kind: HQ_INTAKE_KIND })
    return { ok: true }
  })
}
