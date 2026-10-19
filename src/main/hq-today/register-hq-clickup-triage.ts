// Custom build (hq-clickup-triage): the ClickUp triage's live sources — the ClickUp connection, HQ's
// project pages and the small model — bound once at startup, with «Разобрать» (hq-clickup-review):
// a chat in the task's project, the Claude limit it must leave free, and the IPC that starts it.
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RateLimitService } from '../rate-limits/service'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { AGENT_LAUNCH_METHODS } from '../runtime/rpc/methods/agent-launch'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { mintAgentSessionOperationId } from '../runtime/orchestration/structured-pointer-operation-id'
import { listClickUpOwnerTasksUpdatedSince } from '../clickup/clickup-task-changes'
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { claudeActiveFreePercent } from '../../shared/claude-limit-guard'
import { AGENT_CHAT_PERMISSION_MODE_OPTION_ID } from '../../shared/agent-chat-permission-mode'
import { structuredAgentSessionPayloadFingerprint } from '../../shared/structured-agent-session-mutation'
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

// Why: sorting a handful of edits is a small model's job; the HQ text model stays for writing.
const TRIAGE_MODEL = 'haiku'

/** The chat the launch opened; null when it opened a terminal instead. */
function readLaunchedChat(result: unknown): { sessionId: string; tabId?: string } | null {
  const outcome: unknown =
    result && typeof result === 'object' ? Reflect.get(result, 'outcome') : null
  if (!outcome || typeof outcome !== 'object' || Reflect.get(outcome, 'kind') !== 'structured') {
    return null
  }
  const sessionId: unknown = Reflect.get(outcome, 'sessionId')
  const tabId: unknown = Reflect.get(outcome, 'tabId')
  return typeof sessionId === 'string'
    ? { sessionId, ...(typeof tabId === 'string' ? { tabId } : {}) }
    : null
}

/** Saves Auto on the chat's record; its agent starts with it on the first send. */
async function limitChatToAuto(sessionId: string): Promise<boolean> {
  const host = getStructuredAgentSessionHost()
  const fence = host?.deps.store.getRecord(sessionId)?.lease.runtimeFence
  if (!host || !fence) {
    return false
  }
  const fields = { key: AGENT_CHAT_PERMISSION_MODE_OPTION_ID, value: 'auto' }
  const result = await host
    .setOption(
      { callerKey: `trusted-local:hq-clickup-review:${sessionId}` },
      {
        envelope: {
          sessionId,
          clientOperationId: mintAgentSessionOperationId(Date.now()),
          expectedRuntimeFence: fence,
          payloadFingerprint: structuredAgentSessionPayloadFingerprint({
            method: 'agentSession.setOption',
            sessionId,
            fields
          })
        },
        ...fields
      }
    )
    .catch(() => null)
  return result?.ok === true && host.deps.store.getRecord(sessionId)?.permissionMode === 'auto'
}

function reviewDeps(
  store: Store,
  runtime: OrcaRuntimeService,
  rateLimits: RateLimitService,
  hqPath: string
): HqClickUpReviewDeps {
  const dispatcher = new RpcDispatcher({ runtime, methods: AGENT_LAUNCH_METHODS })
  return {
    workspaceFor: async (project) => {
      const page = (await listHqProjectPages(hqPath).catch(() => [])).find(
        (candidate) => candidate.slug === project
      )
      const repo = page ? store.getRepo(page.repoId) : undefined
      return repo ? { worktreeId: getRepoMainWorktreeId(repo), name: repo.displayName } : null
    },
    launch: async (worktreeId) => {
      const response = await dispatcher.dispatch({
        id: randomUUID(),
        authToken: '',
        method: 'agent.launch',
        params: {
          agent: 'claude',
          target: { kind: 'existing', worktree: `id:${worktreeId}` },
          // Why: the chat opens beside the owner's work, never in front of it.
          presentation: 'background',
          nativeChatDefault: true
        }
      })
      if (!response.ok) {
        return { ok: false, error: response.error.message }
      }
      const chat = readLaunchedChat(response.result)
      return chat
        ? { ok: true, ...chat }
        : { ok: false, error: 'Claude started in a terminal, not a chat.' }
    },
    limit: limitChatToAuto,
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
