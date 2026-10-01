// Custom build (claude-subscriptions): a native chat stopped on its subscription's limit gets a bell
// item offering every other subscription; picking one moves the same chat there and continues it.
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'
import {
  BASE_CLAUDE_SUBSCRIPTION_ID,
  type ClaudeSubscriptionSettings
} from '../../shared/claude-subscriptions'
import { CLAUDE_SUBSCRIPTIONS_ENABLED } from '../../shared/claude-subscriptions-switch'
import { limitStoppedChatBellItem, type PulseBellInput } from '../../shared/pulse-bell'
import {
  claudeChatSubscriptionFor,
  listClaudeChatSubscriptionChoices,
  moveClaudeChatToSubscription,
  type ClaudeChatSubscriptionChoice,
  type ClaudeChatSubscriptionMoveDeps,
  type ClaudeChatSubscriptionMoveResult
} from '../claude-subscriptions/claude-chat-subscription-move'

export type ClaudeChatLimitContinueDeps = {
  settings: () => ClaudeSubscriptionSettings
  /** The base sign-in's dir, as a chat create pins it (managed account dir or `~/.claude`). */
  baseConfigDir: () => string | null
  getRecord: (sessionId: string) => AgentSessionRecord | null
}

export function claudeChatSubscriptionChoices(
  deps: ClaudeChatLimitContinueDeps
): ClaudeChatSubscriptionChoice[] {
  return listClaudeChatSubscriptionChoices(
    deps.settings(),
    deps.baseConfigDir() ?? join(homedir(), '.claude')
  )
}

/** The subscription a chat runs on; null when its dir is none of them (an env-pinned home). */
export function claudeChatSubscriptionIdOf(
  deps: ClaudeChatLimitContinueDeps,
  sessionId: string
): string | null {
  const record = deps.getRecord(sessionId)
  return record?.provider === 'claude'
    ? (claudeChatSubscriptionFor(claudeChatSubscriptionChoices(deps), record.accountHome.path)
        ?.id ?? null)
    : null
}

/** One item per stopped chat that has somewhere else to go. */
export function limitStoppedChatItems(
  deps: ClaudeChatLimitContinueDeps,
  stops: readonly ClaudeLimitStoppedAgent[]
): PulseBellInput[] {
  const choices = claudeChatSubscriptionChoices(deps)
  return stops.flatMap((stop) => {
    const record = stop.kind === 'native-chat' ? deps.getRecord(stop.key) : null
    const current = record ? claudeChatSubscriptionFor(choices, record.accountHome.path) : null
    if (!record || record.provider !== 'claude' || !current) {
      return []
    }
    // Why: with subscriptions off, a chat still pinned to one may only move to the selected account.
    const alternatives = choices.filter(
      (choice) =>
        choice.id !== current.id &&
        (CLAUDE_SUBSCRIPTIONS_ENABLED || choice.id === BASE_CLAUDE_SUBSCRIPTION_ID)
    )
    return alternatives.length === 0
      ? []
      : [
          limitStoppedChatBellItem({
            sessionId: stop.key,
            worktreeId: stop.worktreeId,
            chatTitle: record.conversationName ?? null,
            subscriptionLabel: current.label,
            alternatives,
            stoppedAt: stop.stoppedAt
          })
        ]
  })
}

export type ContinueOnSubscriptionDeps = ClaudeChatLimitContinueDeps &
  Pick<ClaudeChatSubscriptionMoveDeps, 'switchAccountHome' | 'prepareHome' | 'hasTranscript'> & {
    forgetStop: (sessionId: string) => void
    /** Sends the continue prompt, as a limit lifting does. */
    resume: (sessionId: string) => Promise<boolean>
  }

export async function continueChatOnSubscription(
  deps: ContinueOnSubscriptionDeps,
  sessionId: string,
  subscriptionId: string
): Promise<ClaudeChatSubscriptionMoveResult | { ok: false; reason: 'notResumed' }> {
  const moved = await moveClaudeChatToSubscription(
    { ...deps, choices: claudeChatSubscriptionChoices(deps) },
    sessionId,
    subscriptionId
  )
  if (!moved.ok) {
    return moved
  }
  deps.forgetStop(sessionId)
  return (await deps.resume(sessionId)) ? moved : { ok: false, reason: 'notResumed' }
}
