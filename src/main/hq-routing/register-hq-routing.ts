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

const EVERY_MS = 5 * 60_000
const SENDER = 'hq-routing'

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
  provideHqRouting(routing)
  const tick = (): void => {
    void routing.run().catch((error: unknown) => console.warn('[hq-routing] run failed:', error))
  }
  const timer = setInterval(tick, EVERY_MS)
  timer.unref?.()
}
