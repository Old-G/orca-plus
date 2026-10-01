// Custom build (claude-limit-guard): a native chat pins its account folder at launch (upstream
// per-account CLAUDE_CONFIG_DIR), so a chat nudged after a switch moves to the folder launches run in
// now; otherwise "continue" would hit the old account's limit again.
import { join } from 'node:path'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { isLegacyAgentSessionAccountHome } from '../../shared/agent-session-account-home'
import type { StructuredAgentSessionAccountHomeSwitchResult } from '../native-chat/agent-session-wire/structured-agent-session-account-home-switch'

export type ClaudeChatAccountFollowDeps = {
  getRecord: (sessionId: string) => AgentSessionRecord | null
  /** The folder new Claude launches run in; null when it cannot be prepared. */
  routedConfigDir: () => Promise<string | null>
  /** The folder the chat's live child was launched in; undefined when none runs. */
  launchHome?: (sessionId: string) => string | undefined
  switchAccountHome: (
    sessionId: string,
    accountHome: AgentSessionRecord['accountHome']
  ) => Promise<StructuredAgentSessionAccountHomeSwitchResult>
  hasTranscript: (input: {
    providerSessionId: string
    claudeProjectsDir: string
  }) => Promise<boolean>
  log?: (message: string) => void
}

export type ClaudeChatAccountFollowOutcome =
  | 'moved'
  | 'alreadyThere'
  | 'notClaude'
  | 'noRoute'
  | 'transcriptMissing'
  | Extract<StructuredAgentSessionAccountHomeSwitchResult, { ok: false }>['reason']

/** Never throws: a chat that cannot move is still nudged where it is. */
export async function moveClaudeChatToRoutedAccount(
  deps: ClaudeChatAccountFollowDeps,
  sessionId: string
): Promise<ClaudeChatAccountFollowOutcome> {
  const record = deps.getRecord(sessionId)
  if (
    !record ||
    record.provider !== 'claude' ||
    !isLegacyAgentSessionAccountHome(record.accountHome) ||
    record.accountHome.variable !== 'CLAUDE_CONFIG_DIR'
  ) {
    return 'notClaude'
  }
  const target = await deps.routedConfigDir().catch(() => null)
  if (!target) {
    return 'noRoute'
  }
  // Why: the live child keeps the account selected at its spawn, whatever the record names now.
  if (target === (deps.launchHome?.(sessionId) ?? record.accountHome.path)) {
    return 'alreadyThere'
  }
  // Why: `--resume` of a conversation the new folder cannot see exits, and the chat would not start.
  const head = record.providerHandleChain.at(-1)?.handle
  if (
    head?.agent === 'claude' &&
    !(await deps
      .hasTranscript({
        providerSessionId: head.nativeId,
        claudeProjectsDir: join(target, 'projects')
      })
      .catch(() => false))
  ) {
    deps.log?.(`native-chat ${sessionId} stays on its account: transcript not visible in ${target}`)
    return 'transcriptMissing'
  }
  const result = await deps
    .switchAccountHome(sessionId, { variable: 'CLAUDE_CONFIG_DIR', path: target })
    .catch((error: unknown) => {
      deps.log?.(`native-chat ${sessionId} stays on its account: ${String(error)}`)
      return { ok: false, reason: 'leaseHeld' } as const
    })
  if (!result.ok) {
    deps.log?.(`native-chat ${sessionId} stays on its account: ${result.reason}`)
    return result.reason
  }
  deps.log?.(`native-chat ${sessionId} moved to ${target}`)
  return 'moved'
}
