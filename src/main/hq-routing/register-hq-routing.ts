// Custom build (hq-plus-routing): starts HQ+'s routing — HQ/routing.yaml read and carried out every
// five minutes, and `orca hq route` for a look or a run by hand.
import { readFile } from 'node:fs/promises'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RateLimitService } from '../rate-limits/service'
import { gitExecFileAsync } from '../git/runner'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { launchHqBackgroundChat, limitHqChatToAuto } from '../hq-today/hq-background-chat'
import { claudeActiveFreePercent } from '../../shared/claude-limit-guard'
import { getHqSessions } from '../hq-sessions/hq-sessions'
import { createHqRouting, provideHqRouting } from './hq-routing'
import { createHqReplyRouting, HQ_REPLY_HOLD_MS, provideHqReplyRouting } from './hq-routing-replies'
import { parseHqRouting } from './hq-routing-rules'
import { join } from 'node:path'
import { HQ_ROUTING_FILE } from '../../shared/hq-routing'
import { HQ_JOURNAL_UNASSIGNED } from '../../shared/hq-journal'
import { onPulseChanged, emitPulseChanged } from '../orca-plus/pulse/pulse-change-events'
import { deliverWaitingReply } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { passHqWaitingReply } from '../hq-today/hq-waiting-reply-pass'
import { generateHqText } from '../hq-today/hq-task-questions'
import { getHqJournalService } from '../hq-journal/hq-journal-service'
import { hqPlaceOf } from '../hq-journal/hq-journal-rooms'

const EVERY_MS = 5 * 60_000
const SENDER = 'hq-routing'
// Why: a new answer is judged soon after it lands, not on the next five-minute tick.
const REPLY_DEBOUNCE_MS = 3_000

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function git(cwd: string, args: string[]): Promise<string[]> {
  try {
    return (await gitExecFileAsync(args, { cwd })).stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/** The branch holding the newest reviewed commit — the checked-out one when it is among them. */
async function baseBranch(repoPath: string, commits: readonly string[]): Promise<string | null> {
  const newest = commits.at(-1)
  if (!newest) {
    return null
  }
  const holding = await git(repoPath, ['branch', '--contains', newest, '--format=%(refname:short)'])
  const [current] = await git(repoPath, ['branch', '--show-current'])
  return current && holding.includes(current) ? current : (holding[0] ?? null)
}

export function registerHqRouting(
  store: Store,
  runtime: OrcaRuntimeService,
  rateLimits: RateLimitService
): void {
  const hqPath = (): string | null => store.getSettings().hqPath ?? null
  const routing = createHqRouting({
    enabled: () => store.getSettings().hqPlusJournalEnabled !== false,
    hqPath,
    readText,
    pulse: {
      list: (query) => runtime.pulseListJournal(query),
      record: (inputs) => runtime.pulseRecordJournal(inputs),
      noteSessions: (inputs) => runtime.pulseNoteSessions(inputs)
    },
    workspaceFor: async (project) => {
      const hq = hqPath()
      const page = hq
        ? (await listHqProjectPages(hq).catch(() => [])).find((entry) => entry.slug === project)
        : undefined
      const repo = page ? store.getRepo(page.repoId) : undefined
      return repo ? { repoId: repo.id, repoPath: repo.path, name: repo.displayName } : null
    },
    baseBranch,
    launch: (target) => launchHqBackgroundChat(runtime, { kind: 'new-worktree', ...target }),
    limit: (sessionId) => limitHqChatToAuto(sessionId, SENDER),
    nameChat: async (sessionId, name) => {
      await runtime
        .openedAgentSessionRecordStore()
        ?.compareAndSetConversationName(sessionId, name, null)
        .catch(() => null)
    },
    deliver: (sessionId, prompt) => deliverToNativeChat(sessionId, prompt, SENDER),
    freePercent: () => {
      const settings = store.getSettings()
      return claudeActiveFreePercent(
        rateLimits.getState().claude,
        settings.activeClaudeManagedAccountIdsByRuntime?.host ??
          settings.activeClaudeManagedAccountId ??
          null
      )
    },
    projectBusy: async (project) => (await getHqSessions()?.projectBusy(project)) ?? null,
    now: Date.now,
    log: (message) => console.log('[hq-routing]', message)
  })
  // Custom build (hq-plus-person-replies): `person.reply` — answers to the chat that asked, or a card.
  const replies = createHqReplyRouting({
    listWaitings: () => runtime.pulseListWaitings({ direction: 'on-them' }),
    judge: async (prompt) => {
      const hq = hqPath()
      if (!hq) {
        return null
      }
      const result = await generateHqText(
        prompt,
        { emptyResultName: 'reply verdict', operation: 'hq-reply-routing', model: 'haiku' },
        {
          settings: store.getSettings(),
          cwd: hq,
          getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
        }
      )
      return result.ok ? result.text : null
    },
    pass: (waitingId, replyTs, prompt) =>
      passHqWaitingReply(
        {
          listOpen: () => runtime.pulseListWaitings({ status: 'open' }),
          deliver: deliverWaitingReply,
          markDelivered: (id, ts) => void runtime.pulseMarkWaitingReplyDelivered(id, ts)
        },
        waitingId,
        replyTs,
        prompt
      ),
    markDelivered: (id, ts) => void runtime.pulseMarkWaitingReplyDelivered(id, ts),
    address: (sessionId) => runtime.pulseGetSession(sessionId)?.address ?? null,
    dispatch: async (address, prompt) => {
      const sessions = getHqSessions()
      const hq = hqPath()
      if (!sessions || !hq) {
        return null
      }
      try {
        const result = await sessions.dispatch({ cwd: hq }, { address, prompt })
        return { acted: result.acted, how: result.decision.kind, note: result.note }
      } catch (error) {
        return {
          acted: false,
          how: '',
          note: error instanceof Error ? error.message : String(error)
        }
      }
    },
    roomOf: async (project) => {
      const journal = getHqJournalService()
      return journal ? hqPlaceOf(await journal.sources(), { project }).room : HQ_JOURNAL_UNASSIGNED
    },
    personName: (id) => runtime.pulseListPeople().find((person) => person.id === id)?.name ?? null,
    pulse: {
      list: (query) => runtime.pulseListJournal(query),
      record: (inputs) => runtime.pulseRecordJournal(inputs)
    },
    now: Date.now,
    log: (message) => console.log('[hq-routing]', message)
  })
  provideHqReplyRouting(replies)
  const routeReplies = async (dryRun: boolean, since?: number) => {
    const hq = hqPath()
    if (!hq || store.getSettings().hqPlusJournalEnabled === false) {
      return { actions: [], problems: [] as string[] }
    }
    const rules = parseHqRouting(await readText(join(hq, HQ_ROUTING_FILE)))
    const actions = await replies.route(rules.replies, { dryRun, since })
    // Why: an answer the bell held while it was judged must show once the hold is over.
    if (!dryRun && actions.some((action) => action.kind === 'wait')) {
      setTimeout(emitPulseChanged, HQ_REPLY_HOLD_MS).unref?.()
    }
    return { actions, problems: rules.problems }
  }
  let replying: Promise<unknown> | null = null
  const replyPass = (): void => {
    if (replying) {
      return
    }
    replying = routeReplies(false)
      .catch((error: unknown) => console.warn('[hq-routing] replies failed:', error))
      .finally(() => {
        replying = null
      })
  }
  provideHqRouting({
    run: async (options = {}) => {
      const result = await routing.run(options)
      const answered = await routeReplies(options.dryRun === true, options.since)
      return {
        ...result,
        replies: answered.actions,
        problems: [...new Set([...result.problems, ...answered.problems])]
      }
    }
  })
  const tick = (): void => {
    void routing.run().catch((error: unknown) => console.warn('[hq-routing] run failed:', error))
    replyPass()
  }
  const timer = setInterval(tick, EVERY_MS)
  timer.unref?.()
  let soon: ReturnType<typeof setTimeout> | null = null
  onPulseChanged(() => {
    if (soon) {
      clearTimeout(soon)
    }
    soon = setTimeout(() => {
      soon = null
      replyPass()
    }, REPLY_DEBOUNCE_MS)
    soon.unref?.()
  })
}
