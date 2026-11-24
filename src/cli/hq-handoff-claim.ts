// Custom build (hq-handoff-auto, owner 24.11): one handoff, one new chat. A chat that starts its own
// successor asks first whether Orca+ already did; any doubt (an older host, an error) starts it.
import { readInjectedAgentSessionId } from '../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import type { RuntimeClient } from './runtime/client'

const HANDOFF_PROMPT = /^\s*Continue from .*?handoff-[^\s/\\]+\.md/

/**
 * Custom build (hq-handoff-parked, T7 25.11): the launch continues the calling chat's own handoff —
 * «Continue from …handoff-<its Claude session>.md». Only then is the new chat its successor; a chat that
 * starts someone else's handoff (a Lead relaunching a worker) keeps its own thread.
 */
export function continuesOwnHandoff(promptText: string | undefined): boolean {
  const own = process.env.CLAUDE_CODE_SESSION_ID?.trim()
  const named = promptText ? /^\s*Continue from .*?handoff-([^\s/\\]+)\.md/.exec(promptText) : null
  return Boolean(own && named && named[1] === own)
}

/** The line to print instead of a second start, or null to launch as asked. */
export async function handoffStartedByOrca(
  client: Pick<RuntimeClient, 'call' | 'isRemote'>,
  promptText: string | undefined
): Promise<string | null> {
  const caller = readInjectedAgentSessionId()
  if (!caller || client.isRemote || !promptText || !HANDOFF_PROMPT.test(promptText)) {
    return null
  }
  try {
    const response = await client.call<{ taken: boolean; successorSessionId?: string }>(
      'hq.handoffClaim',
      { callerSessionId: caller }
    )
    if (!response.result?.taken) {
      return null
    }
    const successor = response.result.successorSessionId
    return `Orca+ already started this handoff's new chat${successor ? `: ${successor}` : ''}; not starting a second one.`
  } catch {
    return null
  }
}
