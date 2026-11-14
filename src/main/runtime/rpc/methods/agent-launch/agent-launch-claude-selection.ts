// Custom build (chat-default-model, owner 14.11): a Claude chat an agent or Orca+ itself starts
// (`orca agent launch`, `orca worktree create --agent`, a handoff, the dispatcher, Slack, Strata)
// does not take the window's saved selection. That selection is the owner's last pick for chats they
// open themselves; a lead's worker must not change model or effort because of it. Such a launch runs
// the model and effort named for it, else Opus at the effort its role fixes (chat-auto-effort-roles).

import { CLAUDE_NEW_CHAT_MODEL } from '../../../../../shared/native-chat/input/claude-new-chat-model'
import { HQ_CHAT_ROLE_SESSION_OPTION, isHqChatRole } from '../../../../../shared/hq-chat-role'
import { fixedRoleEffort } from '../../../../native-chat/auto-effort/chat-role-effort'
import type { RpcCallerIdentity } from '../../callers/rpc-caller-identity'

/** A window or a paired phone is a person at a picker that shows the saved selection; the `orca` CLI
 *  and Orca+'s own in-process launches (no caller) are not. */
function launchedByAPerson(caller: RpcCallerIdentity | undefined): boolean {
  return caller?.kind === 'desktop' || caller?.kind === 'paired-device'
}

export type AgentLaunchClaudeSelection = {
  /** What the chat starts with; `named` itself when the rule does not apply. */
  options: Readonly<Record<string, string>>
  /** True when these options stand in place of the saved selection instead of over it. */
  replacesSavedSelection: boolean
}

export function agentLaunchClaudeSelection(args: {
  agent: string
  caller: RpcCallerIdentity | undefined
  /** The launch's own model, effort and the like, already narrowed to what a chat accepts. */
  named: Readonly<Record<string, string>>
  /** The launch's raw options, for the role it was given. */
  launchOptions: Readonly<Record<string, unknown>> | undefined
}): AgentLaunchClaudeSelection {
  if (args.agent !== 'claude' || launchedByAPerson(args.caller)) {
    return { options: args.named, replacesSavedSelection: false }
  }
  if (args.named.model) {
    // A named model runs at the effort named with it, or at the CLI's own; never at the window's.
    return { options: args.named, replacesSavedSelection: true }
  }
  const role = args.launchOptions?.[HQ_CHAT_ROLE_SESSION_OPTION]
  const roleEffort = fixedRoleEffort(isHqChatRole(role) ? role : null)
  return {
    options: {
      model: CLAUDE_NEW_CHAT_MODEL,
      ...(roleEffort ? { effort: roleEffort } : {}),
      ...args.named
    },
    replacesSavedSelection: true
  }
}
