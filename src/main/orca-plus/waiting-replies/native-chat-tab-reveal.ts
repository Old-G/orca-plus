// Custom build (chat-tab-reveal): a message Orca+ hands to a chat whose tab was closed while its
// session stayed alive is taken and worked on unseen — running, but in no list on the left. Such a
// chat gets its tab back in its project's sidebar, quietly: no focus, no switch of what is on screen.
import type { StructuredAgentId } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle'

export type NativeChatTabRevealDeps = {
  /** The chat has a tab in the sidebar now. */
  tabShown: (sessionId: string) => boolean
  /** The chat's record: where its tab belongs. Throws when the chat is gone. */
  reveal: (
    sessionId: string
  ) => Promise<{ sessionId: string; workspaceId: string; agent: StructuredAgentId }>
  publish: (tab: {
    sessionId: string
    workspaceId: string
    agent: StructuredAgentId
    activate: false
  }) => Promise<void>
}

export type NativeChatTabReveal = 'listed' | 'shown'

export async function revealNativeChatTabQuietly(
  deps: NativeChatTabRevealDeps,
  sessionId: string
): Promise<NativeChatTabReveal> {
  if (deps.tabShown(sessionId)) {
    return 'listed'
  }
  const chat = await deps.reveal(sessionId)
  await deps.publish({
    sessionId: chat.sessionId,
    workspaceId: chat.workspaceId,
    agent: chat.agent,
    activate: false
  })
  return 'shown'
}

let provided: ((sessionId: string) => Promise<NativeChatTabReveal>) | null = null

export function provideNativeChatTabReveal(deps: NativeChatTabRevealDeps | null): void {
  provided = deps ? (sessionId) => revealNativeChatTabQuietly(deps, sessionId) : null
}

/** Never throws: the message is already delivered; a tab that failed to show is only logged. */
export async function showNativeChatTab(sessionId: string): Promise<void> {
  if (!provided) {
    return
  }
  await provided(sessionId).catch((error: unknown) =>
    console.warn('[chat-tab-reveal] could not show the chat tab', sessionId, error)
  )
}
