// Custom build (hq-clickup-review, hq-plus-routing): a Claude chat Orca+ starts by itself — opened
// beside the owner's work, never in front of it, and held to Auto before any task goes in.
import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { AGENT_LAUNCH_METHODS } from '../runtime/rpc/methods/agent-launch'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { mintAgentSessionOperationId } from '../runtime/orchestration/structured-pointer-operation-id'
import { AGENT_CHAT_PERMISSION_MODE_OPTION_ID } from '../../shared/agent-chat-permission-mode'
import { structuredAgentSessionPayloadFingerprint } from '../../shared/structured-agent-session-mutation'

export type HqBackgroundChatTarget =
  | { kind: 'existing'; worktreeId: string }
  /** A fresh worktree of the repo, branched from `baseBranch` (the repo's default when absent). */
  | { kind: 'new-worktree'; repoId: string; name: string; baseBranch?: string }

export type HqBackgroundChatLaunch =
  | { ok: true; sessionId: string; worktreeId: string; tabId?: string }
  | { ok: false; error: string }

/** The chat the launch opened; null when it opened a terminal instead. */
function readLaunchedChat(
  result: unknown
): { sessionId: string; worktreeId: string | null; tabId?: string } | null {
  const outcome: unknown =
    result && typeof result === 'object' ? Reflect.get(result, 'outcome') : null
  if (!outcome || typeof outcome !== 'object' || Reflect.get(outcome, 'kind') !== 'structured') {
    return null
  }
  const sessionId: unknown = Reflect.get(outcome, 'sessionId')
  const tabId: unknown = Reflect.get(outcome, 'tabId')
  const worktreeId: unknown =
    result && typeof result === 'object' ? Reflect.get(result, 'worktreeId') : null
  return typeof sessionId === 'string'
    ? {
        sessionId,
        worktreeId: typeof worktreeId === 'string' ? worktreeId : null,
        ...(typeof tabId === 'string' ? { tabId } : {})
      }
    : null
}

/** An empty Claude chat; the task goes in only after `limitHqChatToAuto`. */
export async function launchHqBackgroundChat(
  runtime: OrcaRuntimeService,
  target: HqBackgroundChatTarget
): Promise<HqBackgroundChatLaunch> {
  const dispatcher = new RpcDispatcher({ runtime, methods: AGENT_LAUNCH_METHODS })
  const response = await dispatcher.dispatch({
    id: randomUUID(),
    authToken: '',
    method: 'agent.launch',
    params: {
      agent: 'claude',
      target:
        target.kind === 'existing'
          ? { kind: 'existing', worktree: `id:${target.worktreeId}` }
          : {
              kind: 'create-worktree',
              create: {
                repo: `id:${target.repoId}`,
                name: target.name,
                ...(target.baseBranch ? { baseBranch: target.baseBranch } : {})
              }
            },
      // Why: the chat opens beside the owner's work, never in front of it.
      presentation: 'background',
      nativeChatDefault: true
    }
  })
  if (!response.ok) {
    return { ok: false, error: response.error.message }
  }
  const chat = readLaunchedChat(response.result)
  if (!chat) {
    return { ok: false, error: 'Claude started in a terminal, not a chat.' }
  }
  const worktreeId = chat.worktreeId ?? (target.kind === 'existing' ? target.worktreeId : null)
  if (!worktreeId) {
    return { ok: false, error: 'The launch did not say which worktree the chat opened in.' }
  }
  return {
    ok: true,
    sessionId: chat.sessionId,
    worktreeId,
    ...(chat.tabId ? { tabId: chat.tabId } : {})
  }
}

/** Saves Auto on the chat's record; its agent starts with it on the first send. */
export async function limitHqChatToAuto(sessionId: string, caller: string): Promise<boolean> {
  const host = getStructuredAgentSessionHost()
  const fence = host?.deps.store.getRecord(sessionId)?.lease.runtimeFence
  if (!host || !fence) {
    return false
  }
  const fields = { key: AGENT_CHAT_PERMISSION_MODE_OPTION_ID, value: 'auto' }
  const result = await host
    .setOption(
      { callerKey: `trusted-local:${caller}:${sessionId}` },
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
