// Custom build (hq-handoff-auto, owner 24.11): one handoff, one new chat. A chat that starts its own
// successor asks first whether Orca+ already did; any doubt (an older host, an error) starts it.
import { readInjectedAgentSessionId } from '../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import type { RuntimeClient } from './runtime/client'

// Custom build (hq-handoff-once, owner 27.11): the handoff file anywhere in the prompt, not only after a
// leading «Continue from». Chats write their own first line — «W · T3, chat 3. Continue from
// …/handoff-<id>.md» — and such a launch skipped the check: two chats 7 s apart (27.11).
const HANDOFF_FILE = /handoff-([A-Za-z0-9_-]{1,128})\.md/g

function namedHandoffs(promptText: string | undefined): string[] {
  return promptText ? [...promptText.matchAll(HANDOFF_FILE)].map((match) => match[1]) : []
}

/**
 * Custom build (hq-handoff-parked, T7 25.11): the launch continues the calling chat's own handoff — the
 * prompt names …handoff-<its Claude session>.md. Only then is the new chat its successor; a chat that
 * starts someone else's handoff (a Lead relaunching a worker) keeps its own thread.
 */
export function continuesOwnHandoff(promptText: string | undefined): boolean {
  const own = process.env.CLAUDE_CODE_SESSION_ID?.trim()
  return Boolean(own && namedHandoffs(promptText).includes(own))
}

/** Whether to ask Orca+ before launching: the chat's own handoff, or any when its session is unknown. */
function startsAHandoff(promptText: string | undefined): boolean {
  const named = namedHandoffs(promptText)
  if (named.length === 0) {
    return false
  }
  const own = process.env.CLAUDE_CODE_SESSION_ID?.trim()
  return own ? named.includes(own) : true
}

/** The line to print instead of a second start, or null to launch as asked. */
export async function handoffStartedByOrca(
  client: Pick<RuntimeClient, 'call' | 'isRemote'>,
  promptText: string | undefined
): Promise<string | null> {
  const caller = readInjectedAgentSessionId()
  if (!caller || client.isRemote || !startsAHandoff(promptText)) {
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
