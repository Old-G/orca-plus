// Custom build (hq-clickup-triage): the ClickUp triage's live sources — the ClickUp connection, HQ's
// project pages and the small model — bound once at startup, with «Разобрать» (hq-clickup-review):
// a chat in the task's project, the Claude limit it must leave free, and the IPC that starts it.
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RateLimitService } from '../rate-limits/service'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { listClickUpOwnerTasksUpdatedSince } from '../clickup/clickup-task-changes'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { claudeActiveFreePercent } from '../../shared/claude-limit-guard'
import { HqSlackDraftRefParams } from '../../shared/rpc-contract/hq-projects-params'
import { getRepoMainWorktreeId } from '../../shared/worktree/id'
import { runHqClickUpTriage, startHqClickUpTriage } from './hq-clickup-triage'
import {
  provideHqClickUpReviewService,
  replyHqClickUpReview,
  routeHqClickUpReviews,
  startHqClickUpReview,
  type HqClickUpReviewDeps
} from './hq-clickup-review'
import { notifyHqSlackScoutChanged } from './hq-slack-scout'
import { generateHqText } from './hq-task-questions'
import { launchHqBackgroundChat, limitHqChatToAuto } from './hq-background-chat'

// Why: sorting a handful of edits is a small model's job; the HQ text model stays for writing.
const TRIAGE_MODEL = 'haiku'

function reviewDeps(
  store: Store,
  runtime: OrcaRuntimeService,
  rateLimits: RateLimitService,
  hqPath: string
): HqClickUpReviewDeps {
  return {
    workspaceFor: async (project) => {
      const page = (await listHqProjectPages(hqPath).catch(() => [])).find(
        (candidate) => candidate.slug === project
      )
      const repo = page ? store.getRepo(page.repoId) : undefined
      return repo ? { worktreeId: getRepoMainWorktreeId(repo), name: repo.displayName } : null
    },
    launch: async (worktreeId) => {
      const launched = await launchHqBackgroundChat(runtime, { kind: 'existing', worktreeId })
      return launched.ok
        ? {
            ok: true,
            sessionId: launched.sessionId,
            ...(launched.tabId ? { tabId: launched.tabId } : {})
          }
        : launched
    },
    limit: (sessionId) => limitHqChatToAuto(sessionId, 'hq-clickup-review'),
    deliver: (sessionId, prompt) => deliverToNativeChat(sessionId, prompt, 'hq-clickup-review'),
    freePercent: () => {
      const settings = store.getSettings()
      return claudeActiveFreePercent(
        rateLimits.getState().claude,
        settings.activeClaudeManagedAccountIdsByRuntime?.host ??
          settings.activeClaudeManagedAccountId ??
          null
      )
    },
    now: Date.now
  }
}

export function registerHqClickUpTriage(
  store: Store,
  runtime: OrcaRuntimeService,
  rateLimits: RateLimitService
): void {
  const hqPath = (): string | null => store.getSettings().hqPath ?? null
  const noHq = { ok: false as const, error: 'No HQ folder is set.' }
  provideHqClickUpReviewService({
    start: async (draftId) => {
      const hq = hqPath()
      return hq
        ? startHqClickUpReview(hq, draftId, reviewDeps(store, runtime, rateLimits, hq))
        : noHq
    },
    reply: async (reply) => {
      const hq = hqPath()
      return hq ? replyHqClickUpReview(hq, reply, Date.now) : noHq
    }
  })
  ipcMain.handle('hqProjects:startClickUpReview', async (_event, ref: unknown) => {
    const hq = hqPath()
    return hq
      ? startHqClickUpReview(
          hq,
          HqSlackDraftRefParams.parse(ref).id,
          reviewDeps(store, runtime, rateLimits, hq)
        )
      : noHq
  })
  startHqClickUpTriage({
    hqPath,
    enabled: () => store.getSettings().hqChatsView !== false,
    run: (hq) =>
      runHqClickUpTriage(hq, {
        listUpdated: listClickUpOwnerTasksUpdatedSince,
        projects: async () =>
          (await listHqProjectPages(hq).catch(() => [])).map((page) => ({
            slug: page.slug,
            about: page.title ?? page.slug
          })),
        generate: (prompt) =>
          generateHqText(
            prompt,
            {
              emptyResultName: 'triage verdicts',
              operation: 'hq-clickup-triage',
              model: TRIAGE_MODEL
            },
            {
              settings: store.getSettings(),
              cwd: hq,
              getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
            }
          ),
        now: Date.now
      }),
    onAdded: async (hq, cards) => {
      notifyHqSlackScoutChanged()
      await routeHqClickUpReviews(hq, cards, reviewDeps(store, runtime, rateLimits, hq))
    }
  })
}
