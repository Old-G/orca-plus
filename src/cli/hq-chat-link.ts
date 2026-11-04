// Custom build (hq-plus-chat-tree, owner 04.11): a chat that runs `orca agent launch` (or `worktree create
// --agent`) is the new chat's parent in HQ+'s «By work» tree, in any project. Bookkeeping only: a launch
// outside a chat, a terminal agent or an older host links nothing, and the launch never fails over it.
import type { AgentLaunchResult } from '../shared/agent-launch/contracts/agent-launch-intent'
import { readInjectedAgentSessionId } from '../shared/agent-session/lifecycle/agent-session-caller-env'
import type { RuntimeClient } from './runtime-client'

export async function linkLaunchedChat(
  client: Pick<RuntimeClient, 'call' | 'isRemote'>,
  result: Pick<AgentLaunchResult, 'outcome'>
): Promise<void> {
  const parent = readInjectedAgentSessionId()
  if (!parent || client.isRemote || result.outcome.kind !== 'structured') {
    return
  }
  try {
    await client.call('hq.linkChat', {
      callerSessionId: parent,
      sessionId: result.outcome.sessionId
    })
  } catch {
    // Why: the tree loses one line; the chat the owner asked for is already running.
  }
}
