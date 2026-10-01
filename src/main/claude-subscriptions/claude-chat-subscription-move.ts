// Custom build (claude-subscriptions): moves a native Claude chat to another subscription — the same
// chat, record and conversation; its next start resumes there. Subscriptions are host dirs, chosen by
// id here so no client ever hands the host a path.
import { join } from 'node:path'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  BASE_CLAUDE_SUBSCRIPTION_ID,
  type ClaudeSubscriptionSettings
} from '../../shared/claude-subscriptions'
import type { StructuredAgentSessionAccountHomeSwitchResult } from '../native-chat/agent-session-wire/structured-agent-session-account-home-switch'

export type ClaudeChatSubscriptionChoice = { id: string; label: string; configDir: string }

export const CLAUDE_BASE_SUBSCRIPTION_LABEL = 'Main sign-in'

/** The base sign-in first, then each configured subscription, with the dir a chat launch pins. */
export function listClaudeChatSubscriptionChoices(
  settings: ClaudeSubscriptionSettings | null | undefined,
  baseConfigDir: string
): ClaudeChatSubscriptionChoice[] {
  return [
    {
      id: BASE_CLAUDE_SUBSCRIPTION_ID,
      label: CLAUDE_BASE_SUBSCRIPTION_LABEL,
      configDir: baseConfigDir
    },
    ...(settings?.claudeSubscriptions ?? []).map(({ id, label, configDir }) => ({
      id,
      label,
      configDir
    }))
  ]
}

/** Which choice a chat's pinned dir is; matched verbatim, as the CLI keys its login on the string. */
export function claudeChatSubscriptionFor(
  choices: readonly ClaudeChatSubscriptionChoice[],
  configDir: string
): ClaudeChatSubscriptionChoice | null {
  return choices.find((choice) => choice.configDir === configDir) ?? null
}

export type ClaudeChatSubscriptionMoveResult =
  | StructuredAgentSessionAccountHomeSwitchResult
  | { ok: false; reason: 'unknownSubscription' | 'transcriptMissing' }

export type ClaudeChatSubscriptionMoveDeps = {
  getRecord: (sessionId: string) => AgentSessionRecord | null
  switchAccountHome: (
    sessionId: string,
    accountHome: AgentSessionRecord['accountHome']
  ) => Promise<StructuredAgentSessionAccountHomeSwitchResult>
  choices: readonly ClaudeChatSubscriptionChoice[]
  /** Links the shared transcripts into a subscription dir; the base dir needs none. */
  prepareHome: (configDir: string) => void
  hasTranscript: (input: {
    providerSessionId: string
    claudeProjectsDir: string
  }) => Promise<boolean>
}

export async function moveClaudeChatToSubscription(
  deps: ClaudeChatSubscriptionMoveDeps,
  sessionId: string,
  subscriptionId: string
): Promise<ClaudeChatSubscriptionMoveResult> {
  const target = deps.choices.find((choice) => choice.id === subscriptionId)
  if (!target) {
    return { ok: false, reason: 'unknownSubscription' }
  }
  const record = deps.getRecord(sessionId)
  if (!record) {
    return { ok: false, reason: 'missing' }
  }
  if (target.id !== BASE_CLAUDE_SUBSCRIPTION_ID) {
    deps.prepareHome(target.configDir)
  }
  // Why: `--resume` of a conversation the new dir cannot see exits, and the chat would not start.
  const head = record.providerHandleChain.at(-1)?.handle
  if (
    head?.provider === 'claude' &&
    !(await deps.hasTranscript({
      providerSessionId: head.sessionId,
      claudeProjectsDir: join(target.configDir, 'projects')
    }))
  ) {
    return { ok: false, reason: 'transcriptMissing' }
  }
  return deps.switchAccountHome(sessionId, {
    variable: 'CLAUDE_CONFIG_DIR',
    path: target.configDir
  })
}
